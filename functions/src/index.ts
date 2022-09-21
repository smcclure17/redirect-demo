import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { assert } from "@actnowcoalition/assert";
import { UrlData } from "./types";

admin.initializeApp();

/**
 * Generates a unique shortened url slug for a url document whenever one is created.
 *
 * This slug is appended to the document as the field "shortUrl". 
 * If the document already has a "shortUrl" field, this function does nothing.
 * 
 * See TODO below. This ultimately should be replaced, but it's handy for the moment.
 */
exports.createShortUrl = functions.firestore
  .document("/urls/{documentId}")
  .onCreate(async (snap) => {
    const recordData = snap.data();
    const random = (Math.random() + 1).toString(36).substring(2);
    if (recordData.shortUrl) {
      return snap
    } else {
      return snap.ref.set({
        ...recordData,
        shortUrl: random,
      });
    }
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
 * Register a new shortened url.
 * 
 * Requires `content-type: application/json` header and a JSON body (document the args here).
 */
exports.registerUrl = functions.https.onRequest((req, res) => {
  const imageUrl = req.body.imageUrl as string;
  const imageScreenshotUrl = req.body.imageScreenshotUrl as string;
  assert(imageUrl || imageScreenshotUrl, "imageUrl or imageScreenshotUrl must be provided");
  // TODO: We should probably make the shortUrl the ID of the document because:
  // 1. The current document ID is currently never used/is useless.
  // 2. The shortUrl should be unique
  // 3. Then we could return the shortUrl in the response here, allowing the client to use it without any more requests.
  // So, we should move the shortUrl generation to here, and remove the document modifying function.
  
  // For now, I'm just duplicating the logic from createShortUrl so that we can return the shortUrl in the response
  // without a race condition.
  const shortUrl = (Math.random() + 1).toString(36).substring(2);
  const data: UrlData = {
    imageUrl: imageUrl ?? "",
    imageScreenshotUrl: imageScreenshotUrl ?? "",
    url: req.body.url ?? "",
    title: req.body.title ?? "",
    description: req.body.description ?? "",
    shortUrl: shortUrl,
  }

  const db = admin.firestore();
  db.collection("urls").doc().set(data).then(() => {
    const baseUrl = "https://us-central1-test-url-api.cloudfunctions.net/url/";
    res.status(200).send(`${baseUrl}${shortUrl}`);
  }).catch((err) => {
    res.status(500).send(`error ${JSON.stringify(err)}`);
  })
})

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
