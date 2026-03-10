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
  instagram: '#E4405F',
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
  const normalized = platform.toLowerCase();
  return PLATFORM_ICONS[normalized] ? normalized : 'website';
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
