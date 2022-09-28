import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { UrlData } from "./types";
import * as express from "express";
import * as cors from "cors";
import {
  takeAndUploadScreenshot,
  getUrlDocumentDataById,
  createUniqueId,
} from "./utils";

admin.initializeApp();
const app = express();
app.use(cors({ origin: true }));
const runtimeOpts = {
  timeoutSeconds: 300,
  memory: "512MB" as "512MB", // idk why this casting is necessary???
};
exports.api = functions.runWith(runtimeOpts).https.onRequest(app);

/**
 * Register a new shortened url.
 *
 * Requires `content-type: application/json` header and a JSON body (document the args here).
 */
app.post("/registerUrl", async (req, res) => {
  const imageUrl = req.body.imageUrl as string;
  const imageScreenshotUrl = req.body.imageScreenshotUrl as string;
  if (!(imageUrl || imageScreenshotUrl)) {
    res.status(400).send("Missing imageUrl or imageScreenshotUrl parameter.");
    return;
  }

  const urlCollection = admin.firestore().collection("urls");
  const documentId = await createUniqueId(urlCollection);
  let imageScreenshot: string | void;
  // TODO: re-structure this such that the request can return a URL right away, while generating
  // a screenshot in the background, instead of waiting for the screenshot to be generated.
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

  const baseUrl = "https://us-central1-test-url-api.cloudfunctions.net/api/";
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
            .send(
              `error: Document with id ${doc.id} is expected but doesn't exist.`
            );
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
 * Redirects share link url to original url.
 *
 * Expected url structure:
 * https://us-central1-test-url-api.cloudfunctions.net/api/SHORT_URL_HERE
 */
app.get("/:url", (req, res) => {
  const shortUrl = req.params.url;
  if (!shortUrl || shortUrl.length === 0) {
    const errorMsg =
      "Missing URL parameter. " +
      "Expected structure: https://<...>.net/api/SHORT_URL_HERE";
    res.status(400).send(errorMsg);
    return;
  }

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
 * Takes a screenshot of the given url and returns the url of the screenshot.
 *
 * Expected url structure:
 * https://us-central1-test-url-api.cloudfunctions.net/api/screenshot?url=URL_HERE
 *
 */
app.post("/screenshot", async (req, res) => {
  const screenshotUrl = req.query.url as string;
  if (!screenshotUrl || screenshotUrl.length === 0) {
    const errorMsg =
      `Missing url query parameter.` +
      `Expected structure: https://<...>.net/api/screenshot?url=URL_HERE`;
    res.status(400).send(errorMsg);
    return;
  }
  // TODO: check if entry for photo already exists, and if so override the existing entry?
  const documentId = await createUniqueId(admin.firestore().collection("urls"));
  const screenshot = await takeAndUploadScreenshot(screenshotUrl, documentId);
  res.status(200).send(screenshot);
});
