// End-to-end check of the real src/lib/queries.ts against whichever Supabase
// project scripts/run-smoke.mjs was pointed at.
import assert from 'node:assert/strict'
import { supabase } from '../src/lib/supabase'
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  listTags,
  searchRecipes,

  toDraft,
  updateRecipe,
} from '../src/lib/queries'

const log = (label, value) => console.log(`  ${label}: ${value}`)

/** Signs in, creating the account first if the stack was brought up fresh. */
async function ensureAccount(email: string, password: string) {
  const signin = await supabase.auth.signInWithPassword({ email, password })
  if (!signin.error) return signin.data.session
  const signup = await supabase.auth.signUp({ email, password })
  assert.equal(signup.error, null, `sign-up failed for ${email}: ${signup.error?.message}`)
  assert.ok(signup.data.session, `no session after sign-up for ${email}`)
  return signup.data.session
}

const session = await ensureAccount('me@example.com', 'chocolate123')
const userId = session.user.id
console.log('\nsign-in OK, user', userId)

// Start from an empty account so leftover rows from an interrupted run cannot
// satisfy (or break) the exact-count assertions below.
for (const table of ['recipes', 'tags']) {
  const { error } = await supabase
    .from(table)
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  assert.equal(error, null, `could not clear ${table}: ${error?.message}`)
}
console.log('  cleared any leftover recipes and tags')

const id = await createRecipe(
  {
    title: 'Dark Chocolate Cake',
    description: 'Rich cocoa dessert for birthdays.',
    ingredients: '200g dark chocolate\n200g butter\n3 eggs\n150g sugar',
    steps: 'Melt chocolate\nWhisk eggs and sugar\nBake 30 minutes',
    notes: 'Best served slightly warm.',
    prep_time_minutes: '20',
    cook_time_minutes: '30',
    servings: '8',
    rating: '5',
    source_url: 'https://example.com/chocolate-cake',
    tagNames: ['Dessert', 'Baking'],
  },
  userId,
)
log('created', id)

// search by ingredient term
const byIngredient = await searchRecipes('butter')
assert.equal(byIngredient.length, 1, 'search by ingredient should match exactly one')
assert.equal(byIngredient[0].title, 'Dark Chocolate Cake')
log('search "butter"', `${byIngredient.length} hit`)

// search by title prefix (trigram fallback)
assert.equal((await searchRecipes('chocol')).length, 1, 'prefix search should match')
log('search "chocol"', '1 hit')

// tag filter through the RPC (regression: the arg name is tag_ids, not tagIds)
const tags = await listTags()
assert.deepEqual(
  tags.map((t) => t.name).sort(),
  ['Baking', 'Dessert'],
  'tags should be created from tagNames',
)
const dessert = tags.find((t) => t.name === 'Dessert')
const byTag = await searchRecipes('', [dessert.id])
assert.equal(byTag.length, 1, 'tag filter should match the tagged recipe')
assert.deepEqual(byTag[0].tags.map((t) => t.name).sort(), ['Baking', 'Dessert'])
log('tag filter Dessert', `1 hit, tags=${byTag[0].tags.map((t) => t.name).join('/')}`)
log('no filter', `${(await searchRecipes('', [])).length} hit`)

// detail
const detail = await getRecipe(id)
assert.equal(detail.steps.length, 3)
assert.equal(detail.ingredients.length, 4)
assert.equal(detail.prep_time_minutes, 20)
assert.equal(detail.rating, 5)
log('detail', `${detail.ingredients.length} ingredients, ${detail.steps.length} steps`)

// edit: retag and change fields
await updateRecipe(
  id,
  { ...toDraft(detail), title: 'Dark Chocolate Torte', rating: '4', tagNames: ['Dessert', 'Gluten Free'] },
  userId,
)
const edited = await getRecipe(id)
assert.equal(edited.title, 'Dark Chocolate Torte')
assert.equal(edited.rating, 4)
assert.deepEqual(edited.tags.map((t) => t.name).sort(), ['Dessert', 'Gluten Free'])
log('updated', `title=${edited.title}, tags=${edited.tags.map((t) => t.name).join('/')}`)

// validation rejected before hitting the database
await assert.rejects(() => updateRecipe(id, { ...toDraft(edited), title: '   ' }, userId), /Title is required/)
await assert.rejects(() => updateRecipe(id, { ...toDraft(edited), rating: '9' }, userId), /Rating must be between/)
log('validation', 'blank title and rating 9 both rejected')

// a tag name is searchable on its own
const byTagName = await searchRecipes('gluten')
assert.equal(byTagName.length, 1, 'searching by tag name should match')
assert.equal(byTagName[0].title, 'Dark Chocolate Torte')
log('search by tag name', '"gluten" -> Dark Chocolate Torte')

// get_recipe addresses a row directly rather than searching the first page
const direct = await getRecipe(id)
assert.equal(direct.id, id)
assert.deepEqual(direct.tags.map((t) => t.name).sort(), ['Dessert', 'Gluten Free'])
log('get_recipe', 'returns the row with its tags')
await assert.rejects(
  () => getRecipe('00000000-0000-0000-0000-000000000000'),
  /Recipe not found/,
)
log('get_recipe', 'unknown id throws Recipe not found')

// a second account must see nothing of the first account's data
console.log('\nRLS isolation')
await ensureAccount('other@example.com', 'other-pass-123')
const otherId = (await supabase.auth.getUser()).data.user.id
assert.notEqual(otherId, userId)
assert.equal((await listRecipes()).length, 0, 'second account must not see foreign recipes')
assert.equal((await listTags()).length, 0, 'second account must not see foreign tags')
log('second account', 'sees 0 recipes and 0 tags')

// ...and cannot touch the first account's rows even with the id. RLS filters
// rows out of the write rather than raising, so the check is that zero rows
// were affected, not that an error came back.
const { data: crossUpdate } = await supabase
  .from('recipes')
  .update({ title: 'stolen' })
  .eq('id', id)
  .select('id')
assert.equal(crossUpdate.length, 0, 'cross-account update must affect 0 rows')
log('cross-account update', '0 rows affected, no error')
const { data: crossDelete } = await supabase
  .from('recipes')
  .delete()
  .eq('id', id)
  .select('id')
assert.equal(crossDelete.length, 0, 'cross-account delete must affect 0 rows')
log('cross-account delete', '0 rows affected, no error')
const { data: crossRead } = await supabase.from('recipes').select('id').eq('id', id)
assert.equal(crossRead.length, 0, 'cross-account read must return nothing')
log('cross-account read', '0 rows')

// the owner still sees their recipe after those attempts
await ensureAccount('me@example.com', 'chocolate123')
assert.equal((await searchRecipes('torte')).length, 1, 'owner row must survive foreign attempts')
log('owner intact', 'still 1 recipe')

// Signed out, everything is invisible. Depending on the target this surfaces
// either as zero rows or as a permission error: `anon` holds no privileges on
// these tables at all on a current Supabase project, so the request is refused
// outright rather than filtered down to nothing. Both outcomes are correct,
// since the grants at the end of the migration only cover `authenticated`.
await supabase.auth.signOut()
let signedOutRows
try {
  signedOutRows = (await searchRecipes('')).length
  log('signed out', '0 recipes')
} catch (error) {
  assert.match(error.message, /permission denied/i, `unexpected signed-out error: ${error.message}`)
  signedOutRows = 0
  log('signed out', 'refused, anon has no privileges')
}
assert.equal(signedOutRows, 0, 'signed-out client must see nothing')
await ensureAccount('me@example.com', 'chocolate123')

// cleanup
await deleteRecipe(id)
assert.equal((await listRecipes()).length, 0, 'delete should cascade recipe_tags')
log('deleted', 'recipe and tag links gone')

console.log('\nall assertions passed')