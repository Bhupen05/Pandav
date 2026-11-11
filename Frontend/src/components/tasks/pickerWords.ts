// The words around the list, for choosing something other than people
export type PickerWords = { choose: string; search: string; hint: string; loading: string; noMatch: string; empty: string; failure: string }

export const PEOPLE_WORDS: PickerWords = {
  choose: 'Choose people',
  search: 'Search people',
  hint: 'Search by name or email',
  loading: 'Loading people…',
  noMatch: 'Nobody matches that search.',
  empty: 'No one to choose from.',
  failure: "Couldn't load the list of people.",
}

export const TEAM_WORDS: PickerWords = {
  choose: 'Choose a team',
  search: 'Search teams',
  hint: 'Search by team name',
  loading: 'Loading teams…',
  noMatch: 'No team matches that search.',
  empty: 'There are no teams to choose from.',
  failure: "Couldn't load the list of teams.",
}
