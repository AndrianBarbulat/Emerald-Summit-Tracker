import wixLocationFrontend from "wix-location-frontend";

$w.onReady(async function () {
    // Get the document array from your dataset item
    const itemObj = $w("#dynamicDataset").getCurrentItem();
    const files = itemObj?.arraydocument || [];
    console.log("Files found:", files);

    // Prepare repeater data with required _id field
    const repeaterData = files.map((url, index) => ({
        _id: index.toString(),  // Required unique identifier
        url: url,
        fileName: extractFileName(url),
        fileType: getFileType(url)
    }));

    // Load data into repeater
    $w("#repeater1").data = repeaterData;
    console.log(`Repeater loaded with ${repeaterData.length} items`);

    // Configure each repeater item
    $w("#repeater1").forEachItem(($item, itemData) => {
        const button = $item("#button67");
		button.target = "_blank";
        button.label = `Download ${itemData.fileName}`;
        
        // Set appropriate download action
        button.onClick(() => {
            const downloadUrl = itemData.fileType === 'image' 
                ? getSimplifiedWixImageUrl(itemData.url)
                : itemData.url;
                
            wixLocationFrontend.to(downloadUrl);
        });
    });
});

// Improved filename extractor
function extractFileName(url) {
    if (!url) return "File";
    
    try {
        let lastPart = url.split('/').pop() || "";
        lastPart = lastPart.split('#')[0].split('~')[0].split('?')[0];
        
        // URL decode and clean filename
        try {
            lastPart = decodeURIComponent(lastPart);
            const dotIndex = lastPart.lastIndexOf('.');
            return dotIndex > 0 ? lastPart.substring(0, dotIndex) : lastPart;
        } catch (e) {
            return lastPart.split('.')[0] || "File";
        }
    } catch (e) {
        return "File";
    }
}

// Determine file type
function getFileType(url) {
    return url.includes('wix:image:') ? 'image' : 'document';
}

// Get simplified Wix image URL (without filename at end)
function getSimplifiedWixImageUrl(imageUrl) {
    const match = imageUrl.match(/wix:image:\/\/v1\/([^\/]+)/);
    return match ? `https://static.wixstatic.com/media/${match[1]}` : imageUrl;
}