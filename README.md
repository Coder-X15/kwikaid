# TODO:
- Implement the inference endpoint

# Particulars
- Use a Python API (library) for accessing Supabase, and load credentials from a `.env` file (don't add it, I'll deal with it since deployment is my part).
- So, the endpoint has to keep checking an `inference_queue` table on a regular basis, and then if they spot rows which have an `inference` column set to `incomplete` or something of that sort (I'll tell you once the schema has been made), the inference endpoint needs to fetch the image from the store, process it, update the `inference` column with the label and delete the image cache once.
- If any confusion exists, I'll try and reply.