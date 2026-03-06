-- Rename 'processing' → 'stuck' in LeadStatus enum
ALTER TYPE "LeadStatus" RENAME VALUE 'processing' TO 'stuck';

-- Add new 'processing' value (active pipeline work)
ALTER TYPE "LeadStatus" ADD VALUE 'processing' AFTER 'new';
