import { listGroups } from 'backend/groupsApi.web';

$w.onReady(async () => {
  try {
    const groupsList = await listGroups();
    console.log(groupsList);  // This will print all groups with their IDs and names
  } catch (error) {
    console.error(error);
  }
});
