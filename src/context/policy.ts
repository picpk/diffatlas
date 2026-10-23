/** Filename policy only. This does not inspect source code for embedded secrets. */
export function fileExclusionReason(path: string): string | null {
  const parts = path.replace(/\\/g, '/').toLowerCase().split('/');
  const name = parts.at(-1) ?? '';
  if (parts.some(part => ['node_modules', '.git', 'dist', 'dist-server', 'build', 'coverage', '.next', '.cache', 'vendor'].includes(part))) {
    return 'Generated output, dependencies, or repository metadata are excluded.';
  }
  if (parts.some(part => /^(?:\.env(?:\..*)?|credentials?(?:[._-].*)?|secrets?(?:[._-].*)?)$/.test(part)) ||
      /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(name) || /^(?:id_rsa|id_ed25519|id_ecdsa)(?:\..*)?$/.test(name)) {
    return 'Potential credential or secret file is excluded by filename policy.';
  }
  if (/^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|poetry\.lock|uv\.lock|pipfile\.lock|composer\.lock|gemfile\.lock)$/.test(name)) {
    return 'Dependency lockfile is excluded.';
  }
  return null;
}
