# userfeed-canny-importer

This script imports Userfeed feature requests from a CSV file into Canny, categorizing them as features or bugs using OpenAI, and simulating user votes.

## Prerequisites

- [Bun](https://bun.sh/) installed on your system
- A Canny account with API access
- An OpenAI API key
- A CSV file named `feature_requests_export.csv` containing your feature requests

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/canny-feature-importer.git
cd canny-feature-importer
```
2. Install dependencies: `bun install`

## Configuration

The script uses the following environment variables:

- `CANNY_API_KEY`: Your Canny API key
- `OPENAI_API_KEY`: Your OpenAI API key
- `BOARD_ID`: The ID of the Canny board where you want to import features
- `FEATURE_CATEGORY_ID`: The ID of the board category for features
- `BUG_CATEGORY_ID`: The ID of the board category for bugs

You can set these in an `.env` file on the root. If any variables are missing, the script will prompt you to enter them.

## Usage

1. Ensure your `feature_requests_export.csv` file is in the project directory.
2. Run the script: `bun run script.ts`
3. If any required environment variables are missing, the script will prompt you to enter them.
4. The script will process each feature request, creating users, categorizing requests, creating posts, and simulating votes.

## CSV File Format

The `feature_requests_export.csv` file should have the following columns:

- `title`: The title of the feature request
- `description`: A detailed description of the feature request
- `status`: The current status of the request
- `Total Likes`: The number of votes/likes for the request
- `Requested By`: The email of the user who requested the feature
- `created_at`: The date the request was created

## Features

- Imports feature requests from a CSV file to Canny
- Uses OpenAI to categorize requests as features or bugs
- Creates Canny users for each unique requester
- Simulates votes using fake users
- Ensures each fake user only votes once per post

## Notes

- This script creates a `fake_users.json` file to store information about simulated users.

## License

[MIT License](LICENSE)