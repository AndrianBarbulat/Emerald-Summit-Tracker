export function wixEcom_onCheckoutCompleted(event) {
  const checkout = event.data.checkout;
  console.log("Custom Fields raw:", checkout.customFields);

  if (checkout.customFields && checkout.customFields.length > 0) {
    checkout.customFields.forEach(field => {
      console.log(`Field: ${field.title} = ${field.value}`);
    });
  } else {
    console.log("No custom fields found on this checkout.");
  }
}
