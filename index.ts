import { parse } from "csv-parse/sync";
import OpenAI from "openai";
import fs from "fs";

const REQUIRED_ENV_VARS = [
  "CANNY_API_KEY",
  "OPENAI_API_KEY",
  "BOARD_ID",
  "FEATURE_CATEGORY_ID",
  "BUG_CATEGORY_ID",
];

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
    const email = `user${i + 1}@internal.restream.io`;
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
    model: "gpt-3.5-turbo",
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

async function createPost(
  request: FeatureRequest,
  author: CannyUser,
  category: "feature" | "bug"
): Promise<string> {
  console.log(`Creating post: "${request.title}" as ${category}`);
  const response = await fetch("https://canny.io/api/v1/posts/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: config.CANNY_API_KEY,
      boardID: config.BOARD_ID,
      authorID: author.id,
      title: request.title,
      details: request.description,
      categoryID:
        category === "feature"
          ? config.FEATURE_CATEGORY_ID
          : config.BUG_CATEGORY_ID,
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

    for (const request of requests) {
      console.log(`Processing request: "${request.title}"`);
      const author = await createOrUpdateUser(request["Requested By"]);
      const category = await categorizeRequest(
        request.title,
        request.description
      );
      const postID = await createPost(request, author, category);
      await addVotes(postID, parseInt(request["Total Likes"]), fakeUsers);
      console.log(`Imported: ${request.title}`);
    }

    console.log("Import completed successfully!");
  } catch (error) {
    console.error("Error during import:", error);
  }
}

main();
