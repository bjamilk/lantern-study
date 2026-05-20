ALTER TABLE "public"."groups"
DROP CONSTRAINT "groups_parent_id_fkey",
ADD CONSTRAINT "groups_parent_id_fkey"
  FOREIGN KEY ("parent_id")
  REFERENCES "public"."groups"("id")
  ON DELETE SET NULL;
