import { parse } from "csv-parse/sync";
import OpenAI from "openai";
import fs from "fs";
import crypto from "crypto";

const REQUIRED_ENV_VARS = [
  "CANNY_API_KEY",
  "OPENAI_API_KEY",
  "FEATURE_BOARD_ID",
  "BUG_BOARD_ID",
  "EMAIL_FAKE_DOMAIN",
];

interface ImportState {
  cursor: number;
  importedIds: string[];
}

interface FeatureRequest {
  title: string;
  description: string;
  status: string;
  "Total Likes": string;
  "Requested By": string;
  created_at: string;
}

interface CannyUser {
  id: string;
  email: string;
  name: string;
}

interface FakeUser {
  id: string;
  email: string;
  name: string;
}

let config: Record<string, string> = {};

async function getConfig() {
  console.log("Starting configuration retrieval...");
  for (const key of REQUIRED_ENV_VARS) {
    if (process.env[key]) {
      config[key] = process.env[key]!;
      console.log(`Config ${key} found in environment variables.`);
    } else {
      config[key] = await prompt(`Enter ${key}: `);
      console.log(`Config ${key} manually entered.`);
    }
  }
  config.INVALID_POSTS_AI_FILTERING =
    process.env.INVALID_POSTS_AI_FILTERING || "false";
  config.POSTS_AI_ENHANCEMENT = process.env.POSTS_AI_ENHANCEMENT || "false";
  config.PLATFORM_DETAILS = process.env.PLATFORM_DETAILS || "";
  config.MAX_POSTS = process.env.MAX_POSTS || "Infinity";
  console.log("Configuration retrieval completed.");
}

async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
}

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

function readCSV(): FeatureRequest[] {
  console.log("Reading CSV file...");
  const fileContent = fs.readFileSync("feature_requests_export.csv", "utf-8");
  const requests = parse(fileContent, { columns: true });
  console.log(`CSV file read successfully. Found ${requests.length} requests.`);
  return requests;
}

async function createOrUpdateUser(email: string): Promise<CannyUser> {
  console.log(`Creating/Updating user with email: ${email}`);
  const name = generateRandomAlias();
  const response = await fetch(
    "https://canny.io/api/v1/users/create_or_update",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: config.CANNY_API_KEY,
        email,
        name,
        userID: email,
      }),
    }
  );
  const data = await response.json();
  console.log(`User created/updated with ID: ${data.id}`);
  return { id: data.id, email, name };
}

function generateRandomAlias(): string {
  const adjectives = ["Happy", "Clever", "Brave", "Wise", "Kind"];
  const nouns = ["Dolphin", "Tiger", "Eagle", "Fox", "Owl"];
  const alias = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${
    nouns[Math.floor(Math.random() * nouns.length)]
  }`;
  console.log(`Generated random alias: ${alias}`);
  return alias;
}

function loadOrCreateFakeUsers(): FakeUser[] {
  console.log("Loading fake users...");
  try {
    const fileContent = fs.readFileSync("fake_users.json", "utf-8");
    const users = JSON.parse(fileContent);
    console.log(`Loaded ${users.length} fake users from file.`);
    return users;
  } catch {
    console.log("No existing fake users found. Starting with empty list.");
    return [];
  }
}

async function ensureFakeUsers(count: number): Promise<FakeUser[]> {
  console.log(`Ensuring at least ${count} fake users...`);
  let fakeUsers = loadOrCreateFakeUsers();
  const neededUsers = Math.max(count, fakeUsers.length);

  for (let i = fakeUsers.length; i < neededUsers; i++) {
    const email = `fake${i + 1}@${config.EMAIL_FAKE_DOMAIN}`;
    const user = await createOrUpdateUser(email);
    fakeUsers.push(user);
    console.log(`Created new fake user: ${user.email}`);
  }

  fs.writeFileSync("fake_users.json", JSON.stringify(fakeUsers, null, 2));
  console.log(`Fake users list updated. Total users: ${fakeUsers.length}`);
  return fakeUsers;
}

async function categorizeRequest(
  title: string,
  description: string
): Promise<"feature" | "bug"> {
  console.log(`Categorizing request: "${title}"`);
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant that categorizes user requests as either 'feature' or 'bug'.",
      },
      {
        role: "user",
        content: `Categorize the following request as either a "feature" or a "bug":
Title: ${title}
Description: ${description}
Category:`,
      },
    ],
    max_tokens: 1,
  });

  const category = chatCompletion.choices[0]?.message.content
    ?.trim()
    .toLowerCase();
  console.log(`Request categorized as: ${category}`);
  return category === "bug" ? "bug" : "feature";
}

async function isValidRequest(
  title: string,
  description: string
): Promise<boolean> {
  console.log(`Validating request: "${title}"`);
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant that determines if a request is a valid feature request or bug report for ${config.PLATFORM_DETAILS}. Consider the platform details when evaluating the request.`,
      },
      {
        role: "user",
        content: `Is the following a valid feature request or bug report for ${config.PLATFORM_DETAILS}? Answer with only 'yes' or 'no':
Title: ${title}
Description: ${description}
Valid:`,
      },
    ],
    max_tokens: 1,
  });

  const isValid =
    chatCompletion.choices[0]?.message.content?.trim().toLowerCase() === "yes";
  console.log(`Request validity: ${isValid}`);
  return isValid;
}

async function enhanceRequest(
  request: FeatureRequest
): Promise<FeatureRequest> {
  console.log(`Enhancing request: "${request.title}"`);
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant that enhances feature requests and bug reports for ${config.PLATFORM_DETAILS}. Improve the title and description to make them concise and understandable. Do not add Feature Request or Bug in the title.`,
      },
      {
        role: "user",
        content: `Enhance the following request:
Title: ${request.title}
Description: ${request.description}

Provide the enhanced version in the following format:
Enhanced Title: [Your enhanced title]
Enhanced Description: [Your enhanced description]`,
      },
    ],
  });

  const enhancedContent = chatCompletion.choices[0]?.message.content;
  const enhancedTitle =
    enhancedContent?.match(/Enhanced Title: (.+)/)?.[1] || request.title;
  const enhancedDescription =
    enhancedContent?.match(/Enhanced Description: (.+)/s)?.[1] ||
    request.description;

  return {
    ...request,
    title: enhancedTitle,
    description: `${enhancedDescription}\n\nOriginal title: ${request.title}\nOriginal description: ${request.description}`,
  };
}

async function createPost(
  request: FeatureRequest,
  author: CannyUser,
  category: "feature" | "bug"
): Promise<string> {
  console.log(`Creating post: "${request.title}" as ${category}`);
  const boardID =
    category === "feature" ? config.FEATURE_BOARD_ID : config.BUG_BOARD_ID;
  const response = await fetch("https://canny.io/api/v1/posts/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: config.CANNY_API_KEY,
      boardID: boardID,
      authorID: author.id,
      title: request.title,
      details: request.description,
      createdAt: request.created_at,
    }),
  });
  const data = await response.json();
  console.log(`Post created with ID: ${data.id}`);
  return data.id;
}

async function addVotes(
  postID: string,
  count: number,
  fakeUsers: FakeUser[]
): Promise<void> {
  console.log(`Adding ${count} votes to post ${postID}`);
  const shuffledUsers = shuffleArray([...fakeUsers], postID);
  const voters = shuffledUsers.slice(0, count);

  for (const voter of voters) {
    await fetch("https://canny.io/api/v1/votes/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: config.CANNY_API_KEY,
        postID,
        voterID: voter.id,
      }),
    });
    console.log(`Vote added by user: ${voter.email}`);
  }
  console.log(`All ${count} votes added successfully.`);
}

function shuffleArray(array: FakeUser[], seed: string): FakeUser[] {
  console.log(`Shuffling array of ${array.length} users with seed: ${seed}`);
  const seedNumber = seed
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  let m = array.length,
    t,
    i;

  while (m) {
    i = Math.floor(pseudoRandom(seedNumber + m) * m--);
    t = array[m];
    array[m] = array[i];
    array[i] = t;
  }

  console.log("Array shuffled successfully.");
  return array;
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

async function fetchExistingPosts(boardID: string): Promise<Set<string>> {
  console.log(`Fetching existing posts for board ${boardID}...`);
  const existingPosts = new Set<string>();
  let hasMore = true;
  let skip = 0;
  const limit = 100; // Adjust as needed

  while (hasMore) {
    const response = await fetch("https://canny.io/api/v1/posts/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: config.CANNY_API_KEY,
        boardID,
        limit,
        skip,
      }),
    });

    const data = await response.json();
    data.posts.forEach((post: any) => existingPosts.add(post.title));
    hasMore = data.hasMore;
    skip += limit;
  }

  console.log(`Found ${existingPosts.size} existing posts.`);
  return existingPosts;
}
function generateItemId(request: FeatureRequest): string {
  return crypto
    .createHash("md5")
    .update(`${request.title}${request.created_at}`)
    .digest("hex");
}

function loadOrCreateImportState(): ImportState {
  console.log("Loading import state...");
  try {
    const fileContent = fs.readFileSync("import_state.json", "utf-8");
    const state = JSON.parse(fileContent);
    console.log(
      `Loaded import state with cursor at ${state.cursor} and ${state.importedIds.length} imported items.`
    );
    return state;
  } catch {
    console.log("No existing import state found. Starting fresh.");
    return { cursor: 0, importedIds: [] };
  }
}

function saveImportState(state: ImportState) {
  fs.writeFileSync("import_state.json", JSON.stringify(state, null, 2));
  console.log(
    `Import state saved. Cursor: ${state.cursor}, Imported items: ${state.importedIds.length}`
  );
}

async function main() {
  try {
    console.log("Starting import process...");
    await getConfig();
    const requests = readCSV();
    const maxVotes = Math.max(
      ...requests.map((r) => parseInt(r["Total Likes"]))
    );
    console.log(`Maximum number of votes found: ${maxVotes}`);
    const fakeUsers = await ensureFakeUsers(maxVotes);

    const existingFeaturePosts = await fetchExistingPosts(
      config.FEATURE_BOARD_ID
    );
    const existingBugPosts = await fetchExistingPosts(config.BUG_BOARD_ID);

    const maxPosts = parseInt(config.MAX_POSTS);
    let importState = loadOrCreateImportState();
    let importedPosts = importState.importedIds.length;

    for (let i = importState.cursor; i < requests.length; i++) {
      if (importedPosts >= maxPosts) {
        console.log(
          `Reached maximum number of posts (${maxPosts}). Stopping import.`
        );
        break;
      }

      const request = requests[i];
      const itemId = generateItemId(request);

      if (importState.importedIds.includes(itemId)) {
        console.log(`Skipping already imported request: "${request.title}"`);
        continue;
      }

      console.log(`Processing request: "${request.title}"`);
      try {
        if (config.INVALID_POSTS_AI_FILTERING === "true") {
          const isValid = await isValidRequest(
            request.title,
            request.description
          );
          if (!isValid) {
            console.log(`Skipping invalid request: "${request.title}"`);
            continue;
          }
        }

        let enhancedRequest = request;
        if (config.POSTS_AI_ENHANCEMENT === "true") {
          enhancedRequest = await enhanceRequest(request);
        }

        const category = await categorizeRequest(
          enhancedRequest.title,
          enhancedRequest.description
        );

        const existingPosts =
          category === "feature" ? existingFeaturePosts : existingBugPosts;

        if (existingPosts.has(enhancedRequest.title)) {
          console.log(
            `Skipping already existing post: "${enhancedRequest.title}"`
          );
          continue;
        }

        const author = await createOrUpdateUser(request["Requested By"]);
        const postID = await createPost(enhancedRequest, author, category);
        await addVotes(postID, parseInt(request["Total Likes"]), fakeUsers);
        console.log(`Imported: ${enhancedRequest.title}`);

        existingPosts.add(enhancedRequest.title);
        importedPosts++;
        importState.importedIds.push(itemId);
        importState.cursor = i + 1;
        saveImportState(importState);
      } catch (error) {
        console.error(`Error processing request "${request.title}":`, error);
      }
    }

    console.log(
      `Import completed successfully! Imported ${importedPosts} posts.`
    );
  } catch (error) {
    console.error("Error during import:", error);
  }
}

main();
