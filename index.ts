import { parse } from "csv-parse/sync";
import { Configuration, OpenAIApi } from "openai";

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
  for (const key of REQUIRED_ENV_VARS) {
    if (process.env[key]) {
      config[key] = process.env[key]!;
    } else {
      config[key] = await prompt(`Enter ${key}: `);
    }
  }
}

async function prompt(question: string): Promise<string> {
  const response = await Bun.write(Bun.stdout, question);
  return new Promise((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
}

const openai = new OpenAIApi(
  new Configuration({ apiKey: config.OPENAI_API_KEY })
);

function readCSV(): FeatureRequest[] {
  const fileContent = Bun.file("feature_requests_export.csv").text();
  return parse(fileContent, { columns: true });
}

async function createOrUpdateUser(email: string): Promise<string> {
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
        userID: email, // Using email as userID for simplicity
      }),
    }
  );
  const data = await response.json();
  return data.id;
}

function generateRandomAlias(): string {
  const adjectives = ["Happy", "Clever", "Brave", "Wise", "Kind"];
  const nouns = ["Dolphin", "Tiger", "Eagle", "Fox", "Owl"];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${
    nouns[Math.floor(Math.random() * nouns.length)]
  }`;
}

function loadOrCreateFakeUsers(): FakeUser[] {
  try {
    return JSON.parse(Bun.file("fake_users.json").text());
  } catch {
    return [];
  }
}

async function ensureFakeUsers(count: number): Promise<FakeUser[]> {
  let fakeUsers = loadOrCreateFakeUsers();
  const neededUsers = Math.max(count, fakeUsers.length);

  for (let i = fakeUsers.length; i < neededUsers; i++) {
    const email = `fake${i + 1}@example.com`;
    const id = await createOrUpdateUser(email);
    fakeUsers.push({ id, email, name: generateRandomAlias() });
  }

  await Bun.write("fake_users.json", JSON.stringify(fakeUsers, null, 2));
  return fakeUsers;
}

async function categorizeRequest(
  title: string,
  description: string
): Promise<"feature" | "bug"> {
  const prompt = `Categorize the following request as either a "feature" or a "bug":
Title: ${title}
Description: ${description}
Category:`;

  const response = await openai.createCompletion({
    model: "text-davinci-002",
    prompt,
    max_tokens: 1,
    n: 1,
    stop: null,
    temperature: 0.5,
  });

  const category = response.data.choices[0].text?.trim().toLowerCase();
  return category === "bug" ? "bug" : "feature";
}

async function createPost(
  request: FeatureRequest,
  authorID: string,
  category: "feature" | "bug"
): Promise<string> {
  const response = await fetch("https://canny.io/api/v1/posts/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: config.CANNY_API_KEY,
      boardID: config.BOARD_ID,
      authorID,
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
  return data.id;
}

async function addVotes(
  postID: string,
  count: number,
  fakeUsers: FakeUser[]
): Promise<void> {
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
  }
}

function shuffleArray(array: FakeUser[], seed: string): FakeUser[] {
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

  return array;
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

async function main() {
  try {
    await getConfig();
    const requests = readCSV();
    const maxVotes = Math.max(
      ...requests.map((r) => parseInt(r["Total Likes"]))
    );
    const fakeUsers = await ensureFakeUsers(maxVotes);

    for (const request of requests) {
      const authorID = await createOrUpdateUser(request["Requested By"]);
      const category = await categorizeRequest(
        request.title,
        request.description
      );
      const postID = await createPost(request, authorID, category);
      await addVotes(postID, parseInt(request["Total Likes"]), fakeUsers);
      console.log(`Imported: ${request.title}`);
    }

    console.log("Import completed successfully!");
  } catch (error) {
    console.error("Error during import:", error);
  }
}

main();
