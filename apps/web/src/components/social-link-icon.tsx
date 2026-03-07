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

export function SocialLinkIcon({
  platform,
  className,
}: {
  platform: string;
  className?: string | undefined;
}) {
  const Icon = PLATFORM_ICONS[platform.toLowerCase()] ?? Globe;
  return <Icon className={className} />;
}
