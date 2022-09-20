import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
admin.initializeApp()

// Generates a short url slug (in reality it's just a string at the moment) 
// and appends it to the document whenever a new document is added to the urls collection. 
exports.shortenUrl = functions.firestore
  .document('/urls/{linkID}')
  .onCreate(async (snap) => {
    const recordData = snap.data()
    const random = (Math.random() + 1).toString(36).substring(2);

    return snap.ref.set({
      ...recordData,
      short: random,
    });
  });

// Redirects request to Canonical URL that's mapped to the short URL (string).
// e.g https://us-central1-test-url-api.cloudfunctions.net/bigben?url=SHORT_URL_HERE
exports.bigben = functions.https.onRequest((req, res) => {
  const shortUrl = req.query.url as string;
  if (!shortUrl) {
    res.status(400).send('Missing URL parameter');
    return;
  }

  getUrl(shortUrl).then((data) => {
    const canonicalUrl = data.url as string
    const image = data.imageUrl as string
    res.status(200).send(
      `<!doctype html>
        <head>
        <title>Time</title>
        <meta http-equiv="Refresh" content="0; url='${canonicalUrl}'" />
        <meta property="og:url" content url='${canonicalUrl}'/>
        <meta property="og:description" content='This is a description'/>
        <meta property="og:title" content='This is a title'/>
        <meta property="og:image" content="${image}" />
        </head>
      </html>`
    );
  }).catch((err) => {
    {
      res.status(500).send(err);
    }
  })
});

// Fetch Url from Firestore that have matching short URL key value.
async function getUrl(shortUrl: string) {
  const db = admin.firestore();
  const querySnapshot = await db.collection("urls").where("short", "==", shortUrl).get();
  // assume exactly one entry
  return querySnapshot.docs[0].data()
}