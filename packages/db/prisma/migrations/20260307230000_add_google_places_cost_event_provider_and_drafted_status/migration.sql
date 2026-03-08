-- Add GOOGLE_PLACES to CostEventProvider enum
ALTER TYPE "CostEventProvider" ADD VALUE IF NOT EXISTS 'GOOGLE_PLACES';

-- Add 'drafted' to LeadStatus enum (between qualified and rejected)
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'drafted' AFTER 'qualified';
