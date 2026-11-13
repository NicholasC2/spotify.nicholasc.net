import satori from "satori";
import blankImage from "./blank.png";

import { Resvg, initWasm } from "@resvg/resvg-wasm";
import wasmURL from "@resvg/resvg-wasm/index_bg.wasm";

let resvgReady: Promise<void> | undefined;

async function ensureResvg() {
	resvgReady ??= initWasm(wasmURL);
	await resvgReady;
}

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

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/user/")) {
			const accountID = url.pathname.replace("/user/", "");

			const user = await env.spotify?.prepare(`
				SELECT refresh_token
				FROM spotify_users
				WHERE account_id = ?
			`)?.bind(accountID)?.first<{ refresh_token: string }>();

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
			let imageURL;

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
			let imageBase64: string | undefined;

			if (imageURL) {
				const imgFetch = await fetch(imageURL);

				if (imgFetch.ok) {
					const mimeType = imgFetch.headers.get("content-type") || "";

					if (mimeType.startsWith("image/")) {
						const imgBuffer = await imgFetch.arrayBuffer();
						const bytes = new Uint8Array(imgBuffer);

						let binary = "";

						for (let i = 0; i < bytes.length; i += 8192) {
							binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
						}

						imageBase64 = `data:${mimeType};base64,${btoa(binary)}`;
					}

				}
			}

			const width = 400;
			const height = 150;

			const fontData = await fetch(
				"https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Regular.ttf"
			).then((res) => res.arrayBuffer());

			const PlayIcon = () => (
				<svg
					width={height / 12}
					height={height / 12}
					viewBox="0 0 20 20"
					fill="#fff"
				>
					<path d="M0 19h4V5H0v14zm8-14v14h4V5H8z" />
				</svg>
			);

			const PauseIcon = () => (
				<svg
					width={height / 12}
					height={height / 12}
					viewBox="0 0 20 20"
					fill="#fff"
				>
					<path d="M0 5v14l11-7z" />
				</svg>
			);

			const svg = await satori(
				<div
					style={{
						width,
						height,
						display: "flex",
						flexDirection: "row",
						padding: 12,
						boxSizing: "border-box",
						fontFamily: "Roboto",
						gap: 12,
						overflow: "hidden",
						borderRadius: 8,
					}}
				>
					<img
						src={imageBase64 ?? blankImage}
						style={{
							height: "100%",
							aspectRatio: "1 / 1",
							borderRadius: 8,
							objectFit: "cover",
						}}
					/>

					<div
						style={{
							position: "relative",
							flex: 1,
							minWidth: 0,
							display: "flex",
							flexDirection: "column",
							justifyContent: "flex-start",
							gap: 4,
							overflow: "hidden",
						}}
					>
						<div
							style={{
								color: "#fff",
								opacity: songName ? 1 : 0.7,
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
								color: "#fff",
								opacity: 0.7,
								fontSize: height / 10,
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}
						>
							{artists}
						</div>
						{playing && (
							<div
								style={{
									color: "#fff",
									opacity: 0.7,
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
									display: "flex",
									flexDirection: "row",
									alignItems: "center",
									position: "absolute",
									bottom: 0,
									gap: 2
								}}
							>
								{playing.is_playing ? <PlayIcon /> : <PauseIcon />}
								<span>
									{playing.is_playing ? " Playing" : " Paused"}
								</span>
							</div>
						)}
					</div>
				</div>,
				{
					width,
					height,
					fonts: [
						{
							name: "Lato",
							data: fontData,
							weight: 400,
							style: "normal",
						},
					],
				}
			);

			if (url.searchParams.has("png")) {
				await ensureResvg();

				const resvg = new Resvg(svg);
				const png = resvg.render().asPng();

				const pngBuffer = new ArrayBuffer(png.byteLength);
				new Uint8Array(pngBuffer).set(png);

				return new Response(pngBuffer, {
					headers: {
						"Content-Type": "image/png",
						"Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
						Pragma: "no-cache",
						Expires: "0",
					},
				});
			}

			return new Response(svg, {
				headers: {
					"Content-Type": "image/svg+xml; charset=utf-8",
					"Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
					Pragma: "no-cache",
					Expires: "0",
				},
			});
		}

		switch (url.pathname) {
			case "/login": {
				const clientID = env.SPOTIFY_CLIENT_ID || "";
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
	const clientID = env.SPOTIFY_CLIENT_ID || "";
	const clientSecret = env.SPOTIFY_CLIENT_SECRET || "";

	return fetch("https://accounts.spotify.com/api/" + route, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: "Basic " + btoa(clientID + ":" + clientSecret),
		},
		body,
	});
}