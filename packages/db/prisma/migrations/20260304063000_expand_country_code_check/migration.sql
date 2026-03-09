-- Expand country_code check constraint to support all DiscoveryCountryCode values
ALTER TABLE "businesses" DROP CONSTRAINT IF EXISTS "businesses_country_code_check";
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_country_code_check"
  CHECK (country_code IN ('JO','SA','AE','EG','BH','KW','OM','QA','LB','IQ','MA','TN','DZ','LY','YE','SY','PS','SD'));
