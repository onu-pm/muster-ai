/**
 * A stable colourway for a person's avatar.
 *
 * Derived from the name, so the same person is the same colour everywhere and
 * nothing has to be stored. Six ways, matching the `.avatar[data-hue]` rules.
 */
export function hueFor(name: string | null | undefined): number {
  if (!name) return 0;
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum = (sum + name.charCodeAt(i)) % 997;
  return sum % 6;
}
