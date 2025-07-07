import { deleteCurrentMember } from 'backend/web-methods/deleteMember.web';
import wixLocation from 'wix-location';
import wixUsers from 'wix-users';

$w("#deleteButton").onClick(async () => {
  try {
    await deleteCurrentMember();

    setTimeout(() => {
      (async () => {
        await wixUsers.logout();
        wixLocation.to("/account-deleted");
      })();
    }, 500);

  } catch (e) {
    console.error(e);
  }
});
