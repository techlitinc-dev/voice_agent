import { ensureBucket, RECORDINGS_BUCKET } from "../src/lib/storage";

ensureBucket()
  .then(() => {
    console.log(`bucket ready: ${RECORDINGS_BUCKET}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
