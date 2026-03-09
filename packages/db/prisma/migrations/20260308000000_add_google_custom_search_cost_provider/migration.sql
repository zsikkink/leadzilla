DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CostEventProvider'
      AND e.enumlabel = 'GOOGLE_CUSTOM_SEARCH'
  ) THEN
    ALTER TYPE "CostEventProvider" ADD VALUE 'GOOGLE_CUSTOM_SEARCH';
  END IF;
END $$;
