-- CAMP-10: campaign cancel marks unfinished CampaignContacts CANCELLED.
ALTER TYPE "CampaignContactStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
