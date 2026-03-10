import {
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  MessageCircle,
  Music2,
  Twitter,
  Youtube,
  type LucideIcon,
} from 'lucide-react';

const PLATFORM_ICONS: Record<string, LucideIcon> = {
  instagram: Instagram,
  linkedin: Linkedin,
  facebook: Facebook,
  twitter: Twitter,
  x: Twitter,
  youtube: Youtube,
  whatsapp: MessageCircle,
  tiktok: Music2,
  website: Globe,
};

export const SOCIAL_BRAND_COLORS: Record<string, string> = {
  instagram: 'linear-gradient(135deg, #F58529 0%, #DD2A7B 45%, #8134AF 75%, #515BD4 100%)',
  linkedin: '#0A66C2',
  facebook: '#1877F2',
  twitter: '#000000',
  x: '#000000',
  youtube: '#FF0000',
  whatsapp: '#25D366',
  tiktok: '#000000',
  website: '#6366F1',
};

export function normalizeSocialPlatform(platform: string): string {
  const normalized = platform.toLowerCase().trim();
  if (normalized === 'twitter') {
    return 'x';
  }
  return PLATFORM_ICONS[normalized] ? normalized : 'website';
}

export function getSocialPlatformLabel(platform: string): string {
  const normalized = normalizeSocialPlatform(platform);
  if (normalized === 'x') {
    return 'X';
  }
  if (normalized === 'website') {
    return platform.trim().length > 0 ? platform : 'Website';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function SocialLinkIcon({
  platform,
  className,
}: {
  platform: string;
  className?: string | undefined;
}) {
  const Icon = PLATFORM_ICONS[normalizeSocialPlatform(platform)] ?? Globe;
  return <Icon className={className} />;
}
