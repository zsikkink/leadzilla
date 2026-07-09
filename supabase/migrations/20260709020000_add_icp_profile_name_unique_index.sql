DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "public"."IcpProfile"
    GROUP BY "name"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create unique index IcpProfile_name_key because duplicate ICP profile names exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "IcpProfile_name_key"
  ON "public"."IcpProfile" USING "btree" ("name");
