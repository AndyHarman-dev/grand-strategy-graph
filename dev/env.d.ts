declare module 'virtual:test-vault' {
  const vaults: { planned: Record<string, string>; legacy: Record<string, string> };
  export default vaults;
}

declare module '*.css';
