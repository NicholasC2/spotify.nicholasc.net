import React from "react";
import satori from "satori";

type Env = {
  spotify: D1Database;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
};

type SpotifyExternalURLs = {
  external_urls: {
    spotify?: string;
  };
};

type SpotifyArtist = {
  href: string;
  id: string;
  name: string;
  type: string;
  uri: string;
};

type SpotifyImage = {
  height: number;
  width: number;
  url: string;
};

type SpotifyCurrentlyPlaying = {
  is_playing: boolean;
  timestamp: number;
  progress_ms: number;
  item: SpotifyExternalURLs & {
    album: SpotifyExternalURLs & {
      album_type: string;
      artists: SpotifyArtist[];
      href: string;
      id: string;
      images: SpotifyImage[];
      name: string;
      release_date: string;
      release_date_precision: string;
      total_tracks: number;
      type: string;
      uri: string;
    };
    artists: SpotifyArtist[];
    disc_number: number;
    duration_ms: number;
    explicit: boolean;
    href: string;
    id: string;
    is_local: boolean;
    name: string;
    preview_url: string | null;
    track_number: number;
    type: string;
    uri: string;
  };
  currently_playing_type: string;
};

const DEFAULT_CLIENT_ID = "08b9a22fbc70494596574483b2fe19dd";
const DEFAULT_CLIENT_SECRET = "39aa4703c4d44f5db14beed8a00dc83c";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/user/")) {
      const accountID = url.pathname.replace("/user/", "");

      const user = await env.spotify
        .prepare(`
          SELECT refresh_token
          FROM spotify_users
          WHERE account_id = ?
        `)
        .bind(accountID)
        .first<{ refresh_token: string }>();

      if (!user?.refresh_token) {
        return new Response("User not found", { status: 404 });
      }

      const tokenRes = await spotifyPOST(
        env,
        "token",
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: user.refresh_token,
        })
      );

      const tokenData = (await tokenRes.json()) as { access_token?: string };

      if (!tokenData.access_token) {
        return new Response("Token acquisition failed!", { status: 500 });
      }

      const response = await fetch(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        }
      );

      let playing: SpotifyCurrentlyPlaying | null = null;
      if (response.status === 200) {
        playing = (await response.json()) as SpotifyCurrentlyPlaying;
      }

      let songName: string | null = null;
      let artists = "";
      let imageURL = "https://www.iconsdb.com/icons/download/gray/music-record-512.png";

      if (playing) {
        if (playing.item.album.images.length > 0) {
          const largestImage = playing.item.album.images.reduce((largest, current) =>
            current.width > largest.width ? current : largest
          );
          imageURL = largestImage.url;
        }

        songName = playing.item.name;
        artists = playing.item.artists.map((a) => a.name).join(", ");
      }

      // Convert image to base64 so Satori can safely parse it inside Edge workers
      let imageBase64 = imageURL;
      try {
        const imgFetch = await fetch(imageURL);
        const imgBuffer = await imgFetch.arrayBuffer();
        const mimeType = imgFetch.headers.get("content-type") || "image/png";
        imageBase64 = `data:${mimeType};base64,${btoa(String.fromCharCode(...new Uint8Array(imgBuffer)))}`;
      } catch (e) {
        console.error("Failed to fetch image binary", e);
      }

      const width = 800;
      const height = 200;

      const fontData = await fetch(
        "https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Regular.ttf"
      ).then((res) => res.arrayBuffer());

      const PlayIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
      );

      const PauseIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
          <path d="M8 5v14l11-7z" />
        </svg>
      );

      const svg = await satori(
        <div
          style={{
            width,
            height,
            display: "flex",
            flexDirection: "row",
            backgroundColor: "#181818",
            padding: 12,
            boxSizing: "border-box",
            fontFamily: "Roboto",
            gap: 12,
            overflow: "hidden",
            borderRadius: 8,
          }}
        >
          {imageBase64 && (
            <img
              src={imageBase64}
              style={{
                height: "100%",
                aspectRatio: "1 / 1",
                borderRadius: 8,
                background: "#404040",
                objectFit: "cover",
              }}
            />
          )}

          <div
            style={{
              position: "relative",
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 4,
              overflow: "hidden",
            }}
          >
            {playing && (
              <div
                style={{
                  color: "#ffffff",
                  fontSize: height / 12,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  position: "absolute",
                  top: 0,
                }}
              >
                {playing.is_playing ? <PlayIcon /> : <PauseIcon />}
                {playing.is_playing ? " Playing" : " Paused"}
              </div>
            )}
            <div
              style={{
                color: songName ? "#1DB954" : "#6b6b6b",
                fontSize: height / 8,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {songName ?? "Nothing is Playing"}
            </div>
            <div
              style={{
                color: "#ffffff",
                fontSize: height / 10,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {artists}
            </div>
          </div>
        </div>,
        {
          width,
          height,
          fonts: [
            {
              name: "Roboto",
              data: fontData,
              weight: 400,
              style: "normal",
            },
          ],
        }
      );

      return new Response(svg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-cache",
        },
      });
    }

    switch (url.pathname) {
      case "/login": {
        const clientID = env.SPOTIFY_CLIENT_ID || DEFAULT_CLIENT_ID;
        const params = new URLSearchParams({
          response_type: "code",
          client_id: clientID,
          scope: "user-read-currently-playing user-read-playback-state",
          redirect_uri: url.origin + "/callback",
        });

        return Response.redirect("https://accounts.spotify.com/authorize?" + params.toString());
      }

      case "/callback": {
        const code = url.searchParams.get("code");
        if (!code) return new Response("no code!");

        const tokenRes = await spotifyPOST(
          env,
          "token",
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: url.origin + "/callback",
          })
        );

        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          refresh_token?: string;
        };

        if (!tokenData.access_token) {
          return new Response("Login failed");
        }

        const meRes = await fetch("https://api.spotify.com/v1/me", {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        });

        const me = (await meRes.json()) as { id?: string };

        if (!me?.id) return new Response("Login failed");

        await env.spotify
          .prepare(`
            INSERT INTO spotify_users (
              account_id,
              refresh_token
            )
            VALUES (?, ?)
            ON CONFLICT(account_id)
            DO UPDATE SET
              refresh_token = excluded.refresh_token,
              updated_at = unixepoch()
          `)
          .bind(me.id, tokenData.refresh_token)
          .run();

        return Response.redirect(`${url.origin}/user/${me.id}`);
      }

      default: {
        return Response.redirect(url.origin + "/login");
      }
    }
  },
} satisfies ExportedHandler<Env>;

async function spotifyPOST(env: Env, route: string, body?: URLSearchParams) {
  const clientID = env.SPOTIFY_CLIENT_ID || DEFAULT_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;

  return fetch("https://accounts.spotify.com/api/" + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(clientID + ":" + clientSecret),
    },
    body,
  });
}