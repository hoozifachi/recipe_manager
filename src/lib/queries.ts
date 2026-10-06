import { supabase } from './supabase'
import type {
  RecipeDraft,
  RecipeUpdate,
  RecipeWithTags,
  TagRow,
} from './types'

/** Postgres raises this as 23514 for check-constraint violations. */
const CHECK_VIOLATION = '23514'

/**
 * Splits a textarea value into a trimmed, non-empty array. Ingredients and
 * steps are stored one per line so a scraper can populate the same shape.
 */
export function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Parses an optional positive integer, returning null for blank or invalid input. */
function optionalInt(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function optionalRating(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

// Exactly the columns the editor owns. Declared against Update so the same
// shape satisfies both insert and update; title is narrowed to required because
// the form always supplies it.
type DraftFields = RecipeUpdate & { title: string }

/**
 * Turns the editor's draft into column values, throwing on anything the
 * database constraints would refuse. Checking here keeps the message next to
 * the form instead of surfacing as a raw Postgres error.
 */
function validateDraft(draft: RecipeDraft): DraftFields {
  const title = draft.title.trim()
  if (title === '') {
    throw new Error('Title is required.')
  }

  const rating = optionalRating(draft.rating)
  if (rating !== null && (rating < 1 || rating > 5)) {
    throw new Error('Rating must be between 1 and 5.')
  }

  const servings = optionalInt(draft.servings)
  if (servings !== null && servings < 1) {
    throw new Error('Servings must be at least 1.')
  }

  return {
    title,
    description: draft.description.trim() || null,
    ingredients: linesToArray(draft.ingredients),
    steps: linesToArray(draft.steps),
    notes: draft.notes.trim() || null,
    prep_time_minutes: optionalInt(draft.prep_time_minutes),
    cook_time_minutes: optionalInt(draft.cook_time_minutes),
    servings,
    rating,
    source_url: draft.source_url.trim() || null,
  }
}

function describeError(message: string): string {
  if (message.includes(CHECK_VIOLATION)) {
    return 'Some values were out of range. Check the rating, times, and servings.'
  }
  return message
}

/**
 * Whether the sign-up form should be rendered, which is only while no account
 * exists. Callable signed out: the migration grants this one function to anon
 * so the login page can decide before sign-in.
 */
export async function signupAllowed(): Promise<boolean> {
  const { data, error } = await supabase.rpc('signup_allowed')
  if (error) throw new Error(error.message)
  return data === true
}

/** All recipes visible to the signed-in user, newest first. */
export async function listRecipes(): Promise<RecipeWithTags[]> {
  const { data, error } = await supabase.rpc('search_recipes', { query: null })
  if (error) throw new Error(error.message)
  return (data ?? []) as RecipeWithTags[]
}

/**
 * Ranked search across title, ingredients, description, and notes, optionally
 * narrowed to the given tags. An empty query returns everything, which is what
 * the list view wants before the user types anything.
 */
export async function searchRecipes(
  query: string,
  tagIds: string[] = [],
): Promise<RecipeWithTags[]> {
  const { data, error } = await supabase.rpc('search_recipes', {
    query: query.trim() || null,
    tag_ids: tagIds.length > 0 ? tagIds : null,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as RecipeWithTags[]
}

export async function listTags(): Promise<TagRow[]> {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getRecipe(id: string): Promise<RecipeWithTags> {
  const { data, error } = await supabase.rpc('get_recipe', { recipe_id: id })
  if (error) throw new Error(error.message)
  const found = (data ?? [])[0] as RecipeWithTags | undefined
  if (!found) throw new Error('Recipe not found.')
  return found
}

/** Resolves tag names to ids, inserting any that don't exist yet. */
async function resolveTagIds(
  names: string[],
  userId: string,
): Promise<string[]> {
  const cleaned = names.map((n) => n.trim()).filter((n) => n.length > 0)
  if (cleaned.length === 0) return []

  const { data: existing, error: readError } = await supabase
    .from('tags')
    .select('id, name')
    .in('name', cleaned)
  if (readError) throw new Error(readError.message)

  const found = new Map((existing ?? []).map((t) => [t.name, t.id]))
  const missing = cleaned.filter((name) => !found.has(name))

  if (missing.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from('tags')
      .insert(missing.map((name) => ({ name, user_id: userId })))
      .select('id, name')
    if (insertError) {
      // A concurrent insert can race the unique(user_id, name) constraint;
      // re-reading resolves it without surfacing a spurious failure.
      if (!insertError.message.includes('duplicate key')) {
        throw new Error(insertError.message)
      }
      const { data: retry, error: retryError } = await supabase
        .from('tags')
        .select('id, name')
        .in('name', missing)
      if (retryError) throw new Error(retryError.message)
      for (const tag of retry ?? []) found.set(tag.name, tag.id)
    } else {
      for (const tag of inserted ?? []) found.set(tag.name, tag.id)
    }
  }

  return cleaned.map((name) => found.get(name)).filter((id): id is string => !!id)
}

async function syncRecipeTags(
  recipeId: string,
  tagNames: string[],
  userId: string,
): Promise<void> {
  const tagIds = await resolveTagIds(tagNames, userId)

  const { error: deleteError } = await supabase
    .from('recipe_tags')
    .delete()
    .eq('recipe_id', recipeId)
  if (deleteError) throw new Error(deleteError.message)

  if (tagIds.length === 0) return

  const { error: insertError } = await supabase
    .from('recipe_tags')
    .insert(tagIds.map((tag_id) => ({ recipe_id: recipeId, tag_id })))
  if (insertError) throw new Error(insertError.message)
}

export async function createRecipe(
  draft: RecipeDraft,
  userId: string,
): Promise<string> {
  const fields = validateDraft(draft)

  const { data, error: insertError } = await supabase
    .from('recipes')
    .insert({ ...fields, user_id: userId })
    .select('id')
    .single()
  if (insertError) throw new Error(describeError(insertError.message))

  await syncRecipeTags(data.id, draft.tagNames, userId)
  return data.id
}

export async function updateRecipe(
  id: string,
  draft: RecipeDraft,
  userId: string,
): Promise<void> {
  const fields = validateDraft(draft)

  const result = await supabase.from('recipes').update(fields).eq('id', id)
  if (result.error) throw new Error(describeError(result.error.message))

  await syncRecipeTags(id, draft.tagNames, userId)
}

export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Converts a stored recipe back into editor state. */
export function toDraft(recipe: RecipeWithTags): RecipeDraft {
  return {
    title: recipe.title,
    description: recipe.description ?? '',
    ingredients: recipe.ingredients.join('\n'),
    steps: recipe.steps.join('\n'),
    notes: recipe.notes ?? '',
    prep_time_minutes: recipe.prep_time_minutes?.toString() ?? '',
    cook_time_minutes: recipe.cook_time_minutes?.toString() ?? '',
    servings: recipe.servings?.toString() ?? '',
    rating: recipe.rating?.toString() ?? '',
    source_url: recipe.source_url ?? '',
    tagNames: recipe.tags.map((t) => t.name),
  }
}