import wixData from 'wix-data';

$w.onReady(function () {
  $w('#button73').onClick(() => {
    const rawNames = $w('#studentNamesInput').value;
    const rawEmails = $w('#studentEmailsInput').value;

    const studentNames = rawNames
      .split(',')
      .map(name => name.trim())
      .filter(name => name.length > 0);

    const studentEmails = rawEmails
      .split(',')
      .map(email => email.trim())
      .filter(email => email.length > 0);

    if (studentNames.length !== studentEmails.length) {
      console.error("Mismatch between number of names and emails");
      return;
    }

    const insertOperations = studentNames.map((name, index) => {
      return wixData.insert('Students', {
        studentName: name,
        studentEmail: studentEmails[index]
      });
    });

    Promise.all(insertOperations)
      .then(() => {
        console.log("All students added successfully");
        $w('#studentNamesInput').value = '';
        $w('#studentEmailsInput').value = '';
      })
      .catch((error) => {
        console.error("Error adding students:", error);
      });
  });
});
