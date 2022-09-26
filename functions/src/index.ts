import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { UrlData } from "./types";
import { takeScreenshot } from "./screenshot";
import * as crypto from "crypto"

admin.initializeApp();

const STORAGE_BUCKET_NAME = "test-url-api-images";
const runtimeOpts = {
  timeoutSeconds: 300,
  memory: "512MB" as "512MB", // idk why this casting is necessary???
};

/**
 * Register a new shortened url.
 *
 * Requires `content-type: application/json` header and a JSON body (document the args here).
 */
exports.registerUrl = functions
  .runWith(runtimeOpts)
  .https.onRequest(async (req, res) => {
    const imageUrl = req.body.imageUrl as string;
    const imageScreenshotUrl = req.body.imageScreenshotUrl as string;
    if (!(imageUrl || imageScreenshotUrl)) {
      res.status(400).send("Missing imageUrl or imageScreenshotUrl parameter.");
      return;
    }

    const urlCollection = admin.firestore().collection("urls");
    const documentId = await createUniqueId(urlCollection);
    let imageScreenshot: string | void;
    if (imageScreenshotUrl) {
      imageScreenshot = await takeAndUploadScreenshot(
        imageScreenshotUrl,
        documentId
      );
    }

    // TODO: Better way to handle missing data than coercing to empty strings?
    const data: UrlData = {
      imageUrl: imageScreenshot ?? imageUrl ?? "",
      imageScreenshotUrl: imageScreenshotUrl ?? "",
      url: req.body.url ?? "",
      title: req.body.title ?? "",
      description: req.body.description ?? "",
    };

    const baseUrl = "https://us-central1-test-url-api.cloudfunctions.net/url/";
    urlCollection
      .where("url", "==", data.url)
      .get()
      .then((querySnapshot) => {
        // Create a new document if the URL doesn't already have an entry.
        if (querySnapshot.size === 0) {
          urlCollection
            .doc(documentId)
            .set(data)
            .then(() => {
              res.status(200).send(`${baseUrl}${documentId}`);
            })
            .catch((err) => {
              res.status(500).send(`error ${JSON.stringify(err)}`);
            });
        }
        // Update the existing document if the URL already has an entry.
        else if (querySnapshot.size === 1) {
          const doc = querySnapshot.docs[0];
          if (!doc.exists) {
            res
              .status(500)
              .send(`error: Document with id ${doc.id} is expected but doesn't exist.`);
          }
          doc.ref.update(data).then(() => {
            res.status(200).send(`${baseUrl}${doc.id}`);
          });
        } else {
          res
            .status(500)
            .send(
              `error: Unexpected number or documents for URL. Expected 0 or 1, got ${querySnapshot.size}`
            );
        }
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
  if (!querySnapshot.exists) {
    throw new Error(`Document with id ${documentId} doesn't exist`);
  }
  return querySnapshot.data() as UrlData;
}

/**
 * Take screenshot of given url, upload screenshot to storage, and return the url.
 *
 * @param url url to screenshot
 * @param filename name of file to store in storage
 * @returns url of screenshot in storage
 */
async function takeAndUploadScreenshot(url: string, filename: string) {
  const screenshot = await takeScreenshot(url, filename);
  const bucket = admin.storage().bucket(STORAGE_BUCKET_NAME);
  return bucket
    .upload(screenshot, { predefinedAcl: "publicRead" })
    .then(() => {
      return `https://storage.googleapis.com/test-url-api-images/${filename}.png`;
    })
    .catch(() => {
      console.log("Error uploading screenshot to storage.");
    });
}

async function createUniqueId(collection: admin.firestore.CollectionReference): Promise<string> {
  const urlHash = crypto.randomBytes(5).toString("hex");
  const documentWithHash = await collection.doc(urlHash).get()
  if (documentWithHash.exists) {
    console.log("Hash collision. Generating new hash.")
    return createUniqueId(collection)
  } else {
     console.log(`Hash generated: ${urlHash}`)
    return urlHash
  }
}
