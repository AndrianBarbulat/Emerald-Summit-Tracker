// backend/web-methods/deleteMember.web.js
import { webMethod, Permissions } from "wix-web-module";
import { members } from "wix-members.v2";
import wixUsersBackend from 'wix-users-backend';
import { elevate } from "wix-auth";

const elevatedDeleteMember = elevate(members.deleteMember);

export const deleteCurrentMember = webMethod(
  Permissions.Anyone,
  async () => {
    try {
      const currentUser = wixUsersBackend.currentUser;
      if (!currentUser.loggedIn) {
        throw new Error("User not logged in");
      }
      const memberId = currentUser.id;
      console.log("Deleting member with ID:", memberId);
      
      const result = await elevatedDeleteMember(memberId);
      console.log("Member deleted:", result);
      
      return result;
    } catch (error) {
      console.error("Failed to delete member:", error);
      throw error;
    }
  }
);
