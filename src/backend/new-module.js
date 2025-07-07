import { services } from 'wix-bookings.v2';

export async function myQueryFunction() {
  console.log("Backend: starting queryServices");
  const results = await services.queryServices().find();
  console.log("Backend: services fetched:", results.items.length);
  return results.items;
}
