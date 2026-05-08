-- Add group ownership. Existing groups are assigned to their first joined member.
ALTER TABLE "Group" ADD COLUMN "ownerId" TEXT;

UPDATE "Group" g
SET "ownerId" = first_member."userId"
FROM (
  SELECT DISTINCT ON ("groupId") "groupId", "userId"
  FROM "GroupMember"
  ORDER BY "groupId", "joinedAt" ASC
) first_member
WHERE g."id" = first_member."groupId";

ALTER TABLE "Group" ALTER COLUMN "ownerId" SET NOT NULL;

CREATE INDEX "Group_ownerId_idx" ON "Group"("ownerId");

ALTER TABLE "Group" ADD CONSTRAINT "Group_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
