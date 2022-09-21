import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { UrlData } from "./types";

admin.initializeApp();

/**
 * Register a new shortened url.
 *
 * Requires `content-type: application/json` header and a JSON body (document the args here).
 */
exports.registerUrl = functions.https.onRequest((req, res) => {
  const imageUrl = req.body.imageUrl as string;
  const imageScreenshotUrl = req.body.imageScreenshotUrl as string;
  if (!(imageUrl || imageScreenshotUrl)) {
    res.status(400).send("Missing imageUrl or imageScreenshotUrl parameter.");
    return;
  }
  const data: UrlData = {
    imageUrl: imageUrl ?? "",
    imageScreenshotUrl: imageScreenshotUrl ?? "",
    url: req.body.url ?? "",
    title: req.body.title ?? "",
    description: req.body.description ?? "",
  };
  const documentId = (Math.random() + 1).toString(36).substring(2);

  // TODO: We should check if the supplied URL already has a share link.
  // If so, we need to decide how to handle that (overrwite, return existing, etc.)
  const db = admin.firestore();
  db.collection("urls")
    .doc(documentId)
    .set(data)
    .then(() => {
      const baseUrl =
        "https://us-central1-test-url-api.cloudfunctions.net/url/";
      res.status(200).send(`${baseUrl}${documentId}`);
    })
    .catch((err) => {
      res.status(500).send(`error ${JSON.stringify(err)}`);
    });
});

/**
 * Redirects short url to original url.
 *
 * Expected url structure:
 * https://us-central1-test-url-api.cloudfunctions.net/url/SHORT_URL_HERE
 */
exports.url = functions.https.onRequest((req, res) => {
  // Feels hacky but: We split the URL to get the short URL (assumed to be passed
  // at the end of the url). See https://stackoverflow.com/q/50156802/14034347
  const urlComponents = req.url.split("/");
  if (urlComponents.length < 1) {
    res
      .status(400)
      .send(
        "Missing URL parameter." +
          "\n Expected structure: https://....net/url/SHORT_URL_HERE"
      );
    return;
  }
  const shortUrl = urlComponents[urlComponents.length - 1];

  getUrlDocumentDataById(shortUrl)
    .then((data) => {
      const fullUrl = data.url;
      const image = data.imageUrl ?? "";
      const title = data.title ?? "";
      const description = data.description ?? "";
      // TODO need to make sure that http-equiv="Refresh" actually allows us to track clicks/get 
      // analytics. See discussion on redirect methods here: https://stackoverflow.com/a/1562539/14034347
      // TODO: Twitter doesn't like meta/og tags? Add twitter card metadata...
      res.status(200).send(
        `<!doctype html>
          <head>
            <title>Redirecting...</title>
            <meta http-equiv="Refresh" content="0; url='${fullUrl}'" />
            <meta property="og:image" content="${image}" />
            <meta property="og:url" content url='${fullUrl}'/>
            <meta property="og:title" content='${title}'/>
            <meta property="og:description" content='${description}'/>
          </head>
        </html>`
      );
    })
    .catch((err) => {
      res.status(500).send(`Internal Error: ${JSON.stringify(err)}`);
    });
});

/**
 * Fetch corresponding data for a given shortened url from Firestore.
 *
 * Firestore urls collection is structured as records indexed by the shortened url.
 *
 * @param documentId Shortened url for which to fetch data.
 * @returns Promise containing the data for the given short url.
 */
async function getUrlDocumentDataById(documentId: string) {
  const db = admin.firestore();
  const querySnapshot = await db.collection("urls").doc(documentId).get();
  return querySnapshot.data() as UrlData;
}
