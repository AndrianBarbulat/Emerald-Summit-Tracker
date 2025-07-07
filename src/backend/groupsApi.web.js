// backend/groupsApi.js

import { groups } from "wix-groups.v2";
import { webMethod, Permissions } from "wix-web-module";
import { elevate } from "wix-auth";

// Use elevate to get admin permissions for listing groups
const elevatedListGroups = elevate(groups.listGroups);

export const listGroups = webMethod(Permissions.Anyone, async () => {
  try {
    // Call the elevated listGroups method
    const result = await elevatedListGroups();
    return result;
  } catch (error) {
    console.error('Error listing groups:', error);
    throw error;
  }
});
