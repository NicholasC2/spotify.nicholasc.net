declare module "*.png" {
	const value: string;
	export default value;
}

declare module "*.wasm" {
	const wasm: WebAssembly.Module;
	export default wasm;
}