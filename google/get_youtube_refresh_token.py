import os
import webbrowser

from google_auth_oauthlib.flow import InstalledAppFlow


# YouTube permission scope.
# This allows the application to manage the authenticated
# user's YouTube account.
SCOPES = [
    "https://www.googleapis.com/auth/youtube.force-ssl"
]

CLIENT_SECRET_FILE = "client_secret.json"


def main():
    if not os.path.exists(CLIENT_SECRET_FILE):
        print("\nERROR: client_secret.json was not found.")
        print("Place your downloaded Google OAuth JSON file")
        print("in the same folder as this Python script.\n")
        return

    print("\n==============================================")
    print(" YouTube OAuth Refresh Token Generator")
    print("==============================================\n")

    print("Opening Google authorization page in your browser...")
    print("Select the Google account that owns your YouTube channel.")
    print("Then approve the requested YouTube permissions.\n")

    flow = InstalledAppFlow.from_client_secrets_file(
        CLIENT_SECRET_FILE,
        SCOPES
    )

    # Run a local OAuth callback server and automatically
    # open the Google authorization page.
    credentials = flow.run_local_server(
        port=0,
        access_type="offline",
        prompt="consent",
        authorization_prompt_message="Opening browser for Google authorization...",
        success_message="Authorization successful. You can close this browser tab."
    )

    print("\n==============================================")
    print(" SUCCESS")
    print("==============================================\n")

    if credentials.refresh_token:
        print("Your YOUTUBE_REFRESH_TOKEN is:\n")
        print(credentials.refresh_token)

        print("\nAdd it to your .env file as:\n")
        print("YOUTUBE_REFRESH_TOKEN=" + credentials.refresh_token)

        print("\nIMPORTANT:")
        print("- Keep this token private.")
        print("- Do NOT commit it to GitHub.")
        print("- Do NOT share it in screenshots or chat.")
    else:
        print("ERROR: No refresh token was returned.")
        print("\nTry running the script again.")
        print("The script uses prompt='consent' to request a new")
        print("authorization and refresh token.")


if __name__ == "__main__":
    main()