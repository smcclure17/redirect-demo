import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
admin.initializeApp();

/**
 * Generates a unique shortened url slug for a url document whenever one is created.
 *
 * This slug is appended to the document as the field "shortUrl".
 */
exports.createShortUrl = functions.firestore
  .document("/urls/{documentId}")
  .onCreate(async (snap) => {
    const recordData = snap.data();
    const random = (Math.random() + 1).toString(36).substring(2);

    return snap.ref.set({
      ...recordData,
      shortUrl: random,
    });
  });

/**
 * Redirects short url to original url.
 *
 * Expected url structure:
 * https://us-central1-test-url-api.cloudfunctions.net/url/SHORT_URL_HERE
 */
exports.url = functions.https.onRequest((req, res) => {
  // Feels very hacky: Split URL to get the short URL (assumed to be passed at
  //the end of the url). See https://stackoverflow.com/q/50156802/14034347
  const shortComponents = req.url.split("/");
  const shortUrl = shortComponents[shortComponents.length - 1];
  if (!shortUrl) {
    res
      .status(400)
      .send(
        "Missing URL parameter." +
          "\n Expected structure: https://....net/url/SHORT_URL_HERE"
      );
    return;
  }

  getUrlData(shortUrl)
    .then((data) => {
      const canonicalUrl = data.url as string;
      const image = data.imageUrl as string;
      res.status(200).send(
        `<!doctype html>
        <head>
        <title>Redirecting...</title>
        <meta http-equiv="Refresh" content="0; url='${canonicalUrl}'" />
        <meta property="og:url" content url='${canonicalUrl}'/>
        <meta property="og:description" content='This is a description'/>
        <meta property="og:title" content='This is a title'/>
        <meta property="og:image" content="${image}" />
        </head>
      </html>`
      );
    })
    .catch((err) => {
      {
        res.status(500).send(`Internal Error: /n ${JSON.stringify(err)}`);
      }
    });
});

/**
 * Fetch corresponding data for a given shortened url from Firestore.
 *
 * @param shortUrl Shortened url for which to fetch data.
 * @returns Promise containing the data for the given short url.
 */
async function getUrlData(shortUrl: string) {
  const db = admin.firestore();
  const querySnapshot = await db
    .collection("urls")
    .where("shortUrl", "==", shortUrl)
    .get();
  // assume exactly one entry
  const data = querySnapshot.docs[0].data();
  console.log("matching data: ", JSON.stringify(data));
  return data;
}
