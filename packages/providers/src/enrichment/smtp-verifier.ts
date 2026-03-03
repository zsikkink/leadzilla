/**
 * SMTP Email Verifier — verifies email addresses via:
 * 1. MX record lookup (DNS)
 * 2. SMTP RCPT TO handshake
 * 3. Catch-all detection (probe random address)
 * 4. Disposable domain check (static blocklist)
 *
 * Rate limited: 1-2 per second per target domain.
 * Never throws — returns discriminated union per adapter convention.
 */

import { promises as dns } from 'node:dns';
import * as net from 'node:net';

// ── Types ─────────────────────────────────────────────────────────────

export interface SmtpVerifierConfig {
  /** SMTP connection timeout in ms. Default: 10000 */
  timeoutMs?: number | undefined;
  /** HELO domain to announce. Default: 'verify.leadflood.io' */
  heloDomain?: string | undefined;
  /** From address for MAIL FROM. Default: 'verify@leadflood.io' */
  fromAddress?: string | undefined;
  /** Max concurrent connections per domain. Default: 1 */
  maxConcurrentPerDomain?: number | undefined;
  /** Min interval between checks to same domain in ms. Default: 1000 */
  minIntervalMs?: number | undefined;
}

export type SmtpVerificationStatus =
  | 'valid'           // Mailbox exists, not catch-all, not disposable
  | 'catch_all'       // Domain accepts all addresses (can't verify individual)
  | 'invalid'         // Mailbox rejected by server
  | 'disposable'      // Known disposable domain
  | 'no_mx'           // No MX records found
  | 'smtp_error'      // Could not complete SMTP handshake
  | 'timeout';        // Connection or handshake timed out

export interface SmtpVerificationResult {
  email: string;
  status: SmtpVerificationStatus;
  mxHost: string | null;
  smtpCode: number | null;
  smtpMessage: string | null;
  isCatchAll: boolean;
  isDisposable: boolean;
  durationMs: number;
}

// ── Disposable domains (curated subset — ~500 most common) ────────────

const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com', '027168.com', '0815.su', '0clickemail.com', '10minutemail.com',
  '123.com', '12minutemail.com', '1chuan.com', '1pad.de', '20minutemail.com',
  '2prong.com', '30minutemail.com', '33mail.com', '3d-painting.com', '4warding.com',
  '5mail.cf', '5mail.ga', '60minutemail.com', '675hosting.com', '675hosting.net',
  '6url.com', '75hosting.com', '7tags.com', '8mail.cf', '8mail.ga',
  '9ox.net', 'a-bc.net', 'agedmail.com', 'amilegit.com', 'anappthat.com',
  'anonymbox.com', 'antichef.com', 'armyspy.com', 'baxomale.ht.cx', 'beefmilk.com',
  'binkmail.com', 'bio-muesli.net', 'bobmail.info', 'bodhi.lawlita.com', 'bofthew.com',
  'bootybay.de', 'boun.cr', 'bouncr.com', 'breakthru.com', 'brefmail.com',
  'broadbandninja.com', 'bsnow.net', 'buffemail.com', 'bugmenot.com', 'bumpymail.com',
  'bund.us', 'bundes-ede.de', 'burnthespam.info', 'buymoreplays.com', 'buyusedlibrarybooks.org',
  'byom.de', 'c2.hu', 'card.zp.ua', 'casualdx.com', 'cek.pm',
  'cellurl.com', 'centermail.com', 'centermail.net', 'chammy.info', 'cheatmail.de',
  'chilkat.com', 'chogmail.com', 'choicemail1.com', 'clixser.com', 'clrmail.com',
  'cmail.net', 'cmail.org', 'coldemail.info', 'consumerriot.com', 'cool.fr.nf',
  'correo.blogos.net', 'cosmorph.com', 'courriel.fr.nf', 'courrieltemporaire.com', 'crazymailing.com',
  'cubiclink.com', 'curryworld.de', 'cust.in', 'cuvox.de', 'd3p.dk',
  'dacoolest.com', 'dandikmail.com', 'dayrep.com', 'dbunker.com', 'dcemail.com',
  'deadaddress.com', 'deadspam.com', 'deagot.com', 'dealja.com', 'despam.it',
  'despammed.com', 'devnullmail.com', 'dfgh.net', 'digitalsanctuary.com', 'dingbone.com',
  'discard.email', 'discardmail.com', 'discardmail.de', 'disposable.cf', 'disposable.ga',
  'disposableaddress.com', 'disposableemailaddresses.emailmiser.com', 'disposableinbox.com',
  'dispose.it', 'dispostable.com', 'dm.w3internet.co.uk.example.com', 'dodgeit.com',
  'dodgit.com', 'dodgit.org', 'dontreg.com', 'dontsendmespam.de', 'drdrb.com',
  'drdrb.net', 'dropmail.me', 'duam.net', 'dudmail.com', 'dump-email.info',
  'dumpandjunk.com', 'dumpmail.de', 'dumpyemail.com', 'e-mail.com', 'e-mail.org',
  'e4ward.com', 'easytrashmail.com', 'ee1.pl', 'ee2.pl', 'eelmail.com',
  'einrot.com', 'email60.com', 'emailage.cf', 'emailage.ga', 'emailage.gq',
  'emailage.ml', 'emailage.tk', 'emaildienst.de', 'emailgo.de', 'emailias.com',
  'emailigo.de', 'emailinfive.com', 'emaillime.com', 'emailmiser.com', 'emailproxsy.com',
  'emails.ga', 'emailsensei.com', 'emailspam.cf', 'emailspam.ga', 'emailspam.gq',
  'emailspam.ml', 'emailspam.tk', 'emailtemporanea.com', 'emailtemporanea.net',
  'emailtemporar.ro', 'emailtemporario.com.br', 'emailthe.net', 'emailtmp.com',
  'emailto.de', 'emailwarden.com', 'emailx.at.hm', 'emailxfer.com', 'emeil.in',
  'emeil.ir', 'emeraldwebmail.com', 'emil.com', 'emkei.cf', 'emkei.ga',
  'emkei.gq', 'emkei.ml', 'emkei.tk', 'enterto.com', 'ephemail.net',
  'etranquil.com', 'etranquil.net', 'etranquil.org', 'evopo.com', 'example.com',
  'explodemail.com', 'express.net.ua', 'eyepaste.com', 'fakeinbox.com', 'fakeinformation.com',
  'fakemail.fr', 'fakemailz.com', 'fammix.com', 'fansworldwide.de', 'fantasymail.de',
  'fastacura.com', 'fastchevy.com', 'fastchrysler.com', 'fastkawasaki.com', 'fastmazda.com',
  'fastnissan.com', 'fastsubaru.com', 'fastsuzuki.com', 'fasttoyota.com', 'fatflap.com',
  'fdfdsfds.com', 'fightallspam.com', 'filzmail.com', 'fivemail.de', 'fixmail.tk',
  'fizmail.com', 'fleckens.hu', 'flurred.com', 'flyspam.com', 'footard.com',
  'forgetmail.com', 'fr33mail.info', 'frapmail.com', 'freundin.ru', 'friendlymail.co.uk',
  'front14.org', 'fuckingduh.com', 'fudgerub.com', 'fux0ringduh.com', 'garliclife.com',
  'get-mail.cf', 'get-mail.ga', 'get-mail.ml', 'get-mail.tk', 'get1mail.com',
  'get2mail.fr', 'getairmail.cf', 'getairmail.com', 'getairmail.ga', 'getairmail.gq',
  'getairmail.ml', 'getairmail.tk', 'getmails.eu', 'getonemail.com', 'getonemail.net',
  'ghosttexter.de', 'girlsundertheinfluence.com', 'gishpuppy.com', 'gmal.com', 'gmial.com',
  'goat.si', 'goemailgo.com', 'gorillaswithdirtyarmpits.com', 'gotmail.com', 'gotmail.net',
  'gotmail.org', 'gotti.otherinbox.com', 'great-host.in', 'greensloth.com', 'grr.la',
  'gsrv.co.uk', 'guerillamail.biz', 'guerillamail.com', 'guerillamail.de', 'guerillamail.info',
  'guerillamail.net', 'guerillamail.org', 'guerrillamail.biz', 'guerrillamail.com',
  'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamailblock.com', 'gustr.com', 'h8s.org', 'hacccc.com', 'haltospam.com',
  'harakirimail.com', 'hartbot.de', 'hatespam.org', 'hellodream.mobi', 'herp.in',
  'hidemail.de', 'hidzz.com', 'hmamail.com', 'hopemail.biz', 'ieh-mail.de',
  'ikbenansen.com', 'imails.info', 'inbax.tk', 'inbox.si', 'inboxalias.com',
  'inboxclean.com', 'inboxclean.org', 'incognitomail.com', 'incognitomail.net',
  'incognitomail.org', 'insorg-mail.info', 'ipoo.org', 'irish2me.com', 'iwi.net',
  'jetable.com', 'jetable.fr.nf', 'jetable.net', 'jetable.org', 'jnxjn.com',
  'jourrapide.com', 'jsrsolutions.com', 'kasmail.com', 'kaspop.com', 'keepmymail.com',
  'killmail.com', 'killmail.net', 'kingsq.ga', 'kiois.com', 'klassmaster.com',
  'klzlk.com', 'koszmail.pl', 'kurzepost.de', 'lawlita.com', 'lazyinbox.com',
  'letthemeatspam.com', 'lhsdv.com', 'lifebyfood.com', 'link2mail.net', 'litedrop.com',
  'loadby.us', 'login-email.cf', 'login-email.ga', 'login-email.ml', 'login-email.tk',
  'lol.ovpn.to', 'lookugly.com', 'lopl.co.cc', 'lortemail.dk', 'lovemeleaveme.com',
  'lr78.com', 'lroid.com', 'lukop.dk', 'm21.cc', 'mail-temporaire.fr',
  'mail.by', 'mail.mezimages.net', 'mail.zp.ua', 'mail1a.de', 'mail21.cc',
  'mail2rss.org', 'mail333.com', 'mail4trash.com', 'mailbidon.com', 'mailbiz.biz',
  'mailblocks.com', 'mailbucket.org', 'mailcat.biz', 'mailcatch.com', 'mailde.de',
  'mailde.info', 'maildrop.cc', 'maildrop.cf', 'maildrop.ga', 'maildrop.gq',
  'maildrop.ml', 'maildu.de', 'maileater.com', 'mailed.in', 'mailexpire.com',
  'mailfa.tk', 'mailforspam.com', 'mailfree.ga', 'mailfree.gq', 'mailfree.ml',
  'mailfreeonline.com', 'mailfs.com', 'mailguard.me', 'mailhazard.com', 'mailhazard.us',
  'mailhz.me', 'mailimate.com', 'mailin8r.com', 'mailinater.com', 'mailinator.com',
  'mailinator.net', 'mailinator.org', 'mailinator.us', 'mailinator2.com', 'mailincubator.com',
  'mailismagic.com', 'mailmate.com', 'mailme.ir', 'mailme.lv', 'mailmetrash.com',
  'mailmoat.com', 'mailms.com', 'mailnator.com', 'mailnesia.com', 'mailnull.com',
  'mailorg.org', 'mailpick.biz', 'mailquack.com', 'mailrock.biz', 'mailscrap.com',
  'mailshell.com', 'mailsiphon.com', 'mailslapping.com', 'mailslite.com', 'mailtemp.info',
  'mailtemporal.com', 'mailtemporaire.com', 'mailtemporaire.fr', 'mailtrash.net',
  'mailtv.net', 'mailtv.tv', 'mailzilla.com', 'mailzilla.org', 'mailzilla.orgmbx.cc',
  'makemetheking.com', 'manifestgenerator.com', 'manybrain.com', 'mbx.cc', 'mega.zik.dj',
  'meinspamschutz.de', 'meltmail.com', 'messagebeamer.de', 'mezimages.net',
  'ministry-of-silly-walks.de', 'mintemail.com', 'misterpinball.de', 'mmailinater.com',
  'mobi.web.id', 'mobileninja.co.uk', 'mohmal.com', 'moncourrier.fr.nf', 'monemail.fr.nf',
  'monmail.fr.nf', 'monumentmail.com', 'msa.minsmail.com', 'mt2009.com', 'mt2014.com',
  'mx0.wwwnew.eu', 'my10minutemail.com', 'myalias.pw', 'mycard.net.ua',
  'mycleaninbox.net', 'myemailboxy.com', 'mymail-in.net', 'mymailoasis.com',
  'mynetstore.de', 'mypacks.net', 'mypartyclip.de', 'myphantom.com', 'mysamp.de',
  'myspaceinc.com', 'myspaceinc.net', 'myspaceinc.org', 'myspacepimpedup.com', 'mytemp.email',
  'mytempmail.com', 'mytrashmail.com', 'nabala.com', 'neomailbox.com', 'nepwk.com',
  'nervmich.net', 'nervtansen.de', 'netmails.com', 'netmails.net', 'neverbox.com',
  'no-spam.ws', 'noblepioneer.com', 'nobulk.com', 'noclickemail.com', 'nogmailspam.info',
  'nomail.xl.cx', 'nomail2me.com', 'nomorespamemails.com', 'nonspam.eu', 'nonspammer.de',
  'noref.in', 'nospam.ze.tc', 'nospam4.us', 'nospamfor.us', 'nospammail.net',
  'nospamthanks.info', 'nothingtoseehere.ca', 'nowmymail.com', 'nurfuerspam.de',
  'nus.edu.sg', 'nwldx.com', 'objectmail.com', 'obobbo.com', 'odaymail.com',
  'onewaymail.com', 'oopi.org', 'ordinaryamerican.net', 'otherinbox.com',
  'ourklips.com', 'outlawspam.com', 'ovpn.to', 'owlpic.com', 'pancakemail.com',
  'pimpedupmyspace.com', 'pjjkp.com', 'plexolan.de', 'pookmail.com', 'privacy.net',
  'proxymail.eu', 'prtnx.com', 'putthisinyouremail.com', 'qq.com',
  'quickinbox.com', 'rcpt.at', 'reallymymail.com', 'recode.me', 'recursor.net',
  'recyclemail.dk', 'regbypass.com', 'regbypass.comsafe-mail.net', 'rejectmail.com',
  'reliable-mail.com', 'rhyta.com', 'rklips.com', 'rmqkr.net', 'royal.net',
  'rppkn.com', 'rtrtr.com', 's0ny.net', 'safe-mail.net', 'safersignup.de',
  'safetymail.info', 'safetypost.de', 'sandelf.de', 'saynotospams.com', 'scatmail.com',
  'schafmail.de', 'selfdestructingmail.com', 'sendspamhere.com', 'shiftmail.com',
  'shitmail.me', 'shortmail.net', 'sibmail.com', 'sinnlos-mail.de', 'skeefmail.com',
  'slaskpost.se', 'slipry.net', 'slopsbox.com', 'slowslow.de', 'slutty.horse',
  'smashmail.de', 'smellfear.com', 'snakemail.com', 'sneakemail.com', 'sneakymail.de',
  'snkmail.com', 'sofimail.com', 'sofort-mail.de', 'softpls.asia', 'sogetthis.com',
  'soodonims.com', 'spam.la', 'spam.su', 'spam4.me', 'spamavert.com',
  'spambob.com', 'spambob.net', 'spambob.org', 'spambog.com', 'spambog.de',
  'spambog.ru', 'spambox.info', 'spambox.irishspringrealty.com', 'spambox.us',
  'spamcannon.com', 'spamcannon.net', 'spamcero.com', 'spamcon.org', 'spamcorptastic.com',
  'spamcowboy.com', 'spamcowboy.net', 'spamcowboy.org', 'spamday.com', 'spamex.com',
  'spamfighter.cf', 'spamfighter.ga', 'spamfighter.gq', 'spamfighter.ml', 'spamfighter.tk',
  'spamfree24.com', 'spamfree24.de', 'spamfree24.eu', 'spamfree24.info', 'spamfree24.net',
  'spamfree24.org', 'spamgoes.in', 'spamherelots.com', 'spamhereplease.com', 'spamhole.com',
  'spamify.com', 'spaml.com', 'spaml.de', 'spammotel.com', 'spamobox.com',
  'spamoff.de', 'spamslicer.com', 'spamspot.com', 'spamstack.net', 'spamthis.co.uk',
  'spamtrap.ro', 'spamtrail.com', 'spamwc.de', 'speed.1s.fr', 'spikio.com',
  'spoofmail.de', 'squizzy.de', 'sry.li', 'stuffmail.de', 'supergreatmail.com',
  'supermailer.jp', 'superrito.com', 'superstachel.de', 'suremail.info', 'svk.jp',
  'sweetxxx.de', 'tafmail.com', 'tagyoureit.com', 'talkinator.com', 'tapchicuoihoi.com',
  'teewars.org', 'teleworm.com', 'teleworm.us', 'temp-mail.com', 'temp-mail.org',
  'temp-mail.ru', 'tempalias.com', 'tempe4mail.com', 'tempemail.biz', 'tempemail.co.za',
  'tempemail.com', 'tempemail.net', 'tempinbox.com', 'tempinbox.co.uk', 'tempmail.eu',
  'tempmail.it', 'tempmail2.com', 'tempmaildemo.com', 'tempmailer.com', 'tempmailer.de',
  'tempomail.fr', 'temporarily.de', 'temporarioemail.com.br', 'temporaryemail.net',
  'temporaryemail.us', 'temporaryforwarding.com', 'temporaryinbox.com', 'temporarymailaddress.com',
  'tempthe.net', 'thankdog.com', 'thankyou2010.com', 'thc.st', 'thecriminals.com',
  'thisisnotmyrealemail.com', 'thismail.net', 'throwawayemailaddress.com', 'tittbit.in',
  'tmail.ws', 'tmailinator.com', 'toiea.com', 'toomail.biz', 'topranklist.de',
  'tradermail.info', 'trash-amil.com', 'trash-mail.at', 'trash-mail.com', 'trash-mail.de',
  'trash-me.com', 'trash2009.com', 'trashdevil.com', 'trashdevil.de', 'trashmail.at',
  'trashmail.com', 'trashmail.de', 'trashmail.io', 'trashmail.me', 'trashmail.net',
  'trashmail.org', 'trashmail.ws', 'trashmailer.com', 'trashymail.com', 'trashymail.net',
  'trbvm.com', 'trbvn.com', 'trialmail.de', 'trickmail.net', 'trillianpro.com',
  'turual.com', 'twinmail.de', 'tyldd.com', 'uggsrock.com', 'umail.net',
  'upliftnow.com', 'uplipht.com', 'venompen.com', 'veryreallyniceithink.com',
  'viditag.com', 'viewcastmedia.com', 'viewcastmedia.net', 'viewcastmedia.org',
  'vomoto.com', 'vp.ycare.de', 'vsimcard.com', 'vubby.com', 'wasteland.rfc822.org',
  'webemail.me', 'weg-werf-email.de', 'wegwerfadresse.de', 'wegwerfemail.com',
  'wegwerfemail.de', 'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org',
  'wh4f.org', 'whatiaas.com', 'whatpaas.com', 'whyspam.me', 'wickmail.net',
  'wilemail.com', 'willhackforfood.biz', 'willselfdestruct.com', 'winemaven.info',
  'wronghead.com', 'wuzup.net', 'wuzupmail.net', 'wwwnew.eu', 'x.ip6.li',
  'xagloo.com', 'xemaps.com', 'xents.com', 'xjoi.com', 'xmaily.com',
  'xn--9kq967o.com', 'xoxy.net', 'yapped.net', 'yeah.net', 'yep.it',
  'yogamaven.com', 'yomail.info', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'yuurok.com', 'zehnminutenmail.de', 'zippymail.info', 'zoaxe.com', 'zoemail.org',
]);

// ── Rate limiter ──────────────────────────────────────────────────────

const domainLastCheck = new Map<string, number>();

function waitForDomainRateLimit(domain: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const last = domainLastCheck.get(domain) ?? 0;
  const elapsed = now - last;
  if (elapsed >= minIntervalMs) {
    domainLastCheck.set(domain, now);
    return Promise.resolve();
  }
  const waitMs = minIntervalMs - elapsed;
  domainLastCheck.set(domain, now + waitMs);
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

// ── SMTP connection helpers ───────────────────────────────────────────

interface SmtpResponse {
  code: number;
  message: string;
}

function parseSmtpResponse(data: string): SmtpResponse {
  const match = data.match(/^(\d{3})\s?(.*)/);
  if (!match) {
    return { code: 0, message: data.trim() };
  }
  return { code: parseInt(match[1]!, 10), message: match[2]?.trim() ?? '' };
}

function sendSmtpCommand(
  socket: net.Socket,
  command: string,
  timeoutMs: number,
): Promise<SmtpResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SMTP timeout waiting for response to: ${command.trim()}`));
    }, timeoutMs);

    socket.once('data', (data: Buffer) => {
      clearTimeout(timer);
      resolve(parseSmtpResponse(data.toString()));
    });

    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.write(command + '\r\n');
  });
}

function waitForGreeting(socket: net.Socket, timeoutMs: number): Promise<SmtpResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('SMTP timeout waiting for server greeting'));
    }, timeoutMs);

    // Accumulate multi-line greetings
    let buffer = '';
    const onData = (data: Buffer) => {
      buffer += data.toString();
      // Greeting is complete when we see "220 " (space, not dash) at start of a line
      const lines = buffer.split('\r\n');
      for (const line of lines) {
        if (/^\d{3}\s/.test(line)) {
          clearTimeout(timer);
          socket.removeListener('data', onData);
          resolve(parseSmtpResponse(line));
          return;
        }
      }
    };

    socket.on('data', onData);
    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      reject(err);
    });
  });
}

// ── DNS helpers ───────────────────────────────────────────────────────

async function resolveMx(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) return null;
    // Sort by priority (lowest = highest priority)
    records.sort((a, b) => a.priority - b.priority);
    return records[0]!.exchange;
  } catch {
    return null;
  }
}

// ── Main verifier class ──────────────────────────────────────────────

export class SmtpVerifier {
  private readonly timeoutMs: number;
  private readonly heloDomain: string;
  private readonly fromAddress: string;
  private readonly minIntervalMs: number;

  constructor(config?: SmtpVerifierConfig | undefined) {
    this.timeoutMs = config?.timeoutMs ?? 10_000;
    this.heloDomain = config?.heloDomain ?? 'verify.leadflood.io';
    this.fromAddress = config?.fromAddress ?? 'verify@leadflood.io';
    this.minIntervalMs = config?.minIntervalMs ?? 1000;
  }

  get isConfigured(): boolean {
    return true; // No external API key needed
  }

  /**
   * Verify an email address via SMTP handshake.
   */
  async verify(email: string): Promise<SmtpVerificationResult> {
    const startMs = Date.now();
    const emailLower = email.toLowerCase().trim();
    const atIndex = emailLower.indexOf('@');
    if (atIndex < 1) {
      return this.buildResult(emailLower, 'invalid', null, null, null, false, false, startMs);
    }

    const domain = emailLower.slice(atIndex + 1);

    // 1. Disposable domain check
    if (DISPOSABLE_DOMAINS.has(domain)) {
      return this.buildResult(emailLower, 'disposable', null, null, null, false, true, startMs);
    }

    // 2. MX record lookup
    const mxHost = await resolveMx(domain);
    if (!mxHost) {
      return this.buildResult(emailLower, 'no_mx', null, null, null, false, false, startMs);
    }

    // 3. Rate limit per domain
    await waitForDomainRateLimit(domain, this.minIntervalMs);

    // 4. SMTP handshake
    let socket: net.Socket | null = null;
    try {
      socket = await this.connectToMx(mxHost);

      // Wait for greeting
      const greeting = await waitForGreeting(socket, this.timeoutMs);
      if (greeting.code !== 220) {
        return this.buildResult(emailLower, 'smtp_error', mxHost, greeting.code, greeting.message, false, false, startMs);
      }

      // EHLO/HELO
      const ehlo = await sendSmtpCommand(socket, `EHLO ${this.heloDomain}`, this.timeoutMs);
      if (ehlo.code !== 250) {
        // Try HELO fallback
        const helo = await sendSmtpCommand(socket, `HELO ${this.heloDomain}`, this.timeoutMs);
        if (helo.code !== 250) {
          return this.buildResult(emailLower, 'smtp_error', mxHost, helo.code, helo.message, false, false, startMs);
        }
      }

      // MAIL FROM
      const mailFrom = await sendSmtpCommand(socket, `MAIL FROM:<${this.fromAddress}>`, this.timeoutMs);
      if (mailFrom.code !== 250) {
        return this.buildResult(emailLower, 'smtp_error', mxHost, mailFrom.code, mailFrom.message, false, false, startMs);
      }

      // RCPT TO — the actual verification
      const rcptTo = await sendSmtpCommand(socket, `RCPT TO:<${emailLower}>`, this.timeoutMs);

      // 5. Catch-all detection — probe a random address
      let isCatchAll = false;
      if (rcptTo.code === 250) {
        // Reset and test with random address
        await sendSmtpCommand(socket, 'RSET', this.timeoutMs);
        await sendSmtpCommand(socket, `MAIL FROM:<${this.fromAddress}>`, this.timeoutMs);
        const randomUser = `leadflood-verify-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const catchAllTest = await sendSmtpCommand(
          socket,
          `RCPT TO:<${randomUser}@${domain}>`,
          this.timeoutMs,
        );
        isCatchAll = catchAllTest.code === 250;
      }

      // QUIT
      sendSmtpCommand(socket, 'QUIT', 3000).catch(() => {});

      // Determine status
      if (rcptTo.code === 250) {
        const status: SmtpVerificationStatus = isCatchAll ? 'catch_all' : 'valid';
        return this.buildResult(emailLower, status, mxHost, rcptTo.code, rcptTo.message, isCatchAll, false, startMs);
      }

      // 550, 551, 552, 553 = mailbox doesn't exist
      if (rcptTo.code >= 550 && rcptTo.code <= 559) {
        return this.buildResult(emailLower, 'invalid', mxHost, rcptTo.code, rcptTo.message, false, false, startMs);
      }

      // 450, 451, 452 = temporary failure (greylisting, etc.)
      // Treat as valid-ish since greylisting means the server is at least real
      if (rcptTo.code >= 450 && rcptTo.code <= 459) {
        return this.buildResult(emailLower, 'valid', mxHost, rcptTo.code, rcptTo.message, false, false, startMs);
      }

      return this.buildResult(emailLower, 'smtp_error', mxHost, rcptTo.code, rcptTo.message, false, false, startMs);
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.message.includes('timeout');
      return this.buildResult(
        emailLower,
        isTimeout ? 'timeout' : 'smtp_error',
        mxHost,
        null,
        err instanceof Error ? err.message : 'Unknown SMTP error',
        false,
        false,
        startMs,
      );
    } finally {
      if (socket && !socket.destroyed) {
        socket.destroy();
      }
    }
  }

  /**
   * Quick check — returns true if email is likely valid (valid or catch_all).
   * Use this as the gate before skipping Hunter in business.convert.
   */
  async isLikelyValid(email: string): Promise<boolean> {
    const result = await this.verify(email);
    return result.status === 'valid' || result.status === 'catch_all';
  }

  private connectToMx(mxHost: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout to ${mxHost}:25`));
      }, this.timeoutMs);

      const socket = net.createConnection(25, mxHost, () => {
        clearTimeout(timer);
        resolve(socket);
      });

      socket.once('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private buildResult(
    email: string,
    status: SmtpVerificationStatus,
    mxHost: string | null,
    smtpCode: number | null,
    smtpMessage: string | null,
    isCatchAll: boolean,
    isDisposable: boolean,
    startMs: number,
  ): SmtpVerificationResult {
    return {
      email,
      status,
      mxHost,
      smtpCode,
      smtpMessage,
      isCatchAll,
      isDisposable,
      durationMs: Date.now() - startMs,
    };
  }
}
