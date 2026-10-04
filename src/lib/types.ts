export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      recipes: {
        Row: {
          cook_time_minutes: number | null
          created_at: string
          description: string | null
          id: string
          ingredients: string[]
          notes: string | null
          prep_time_minutes: number | null
          rating: number | null
          search_vector: unknown
          servings: number | null
          source_url: string | null
          steps: string[]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cook_time_minutes?: number | null
          created_at?: string
          description?: string | null
          id?: string
          ingredients?: string[]
          notes?: string | null
          prep_time_minutes?: number | null
          rating?: number | null
          servings?: number | null
          source_url?: string | null
          steps?: string[]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cook_time_minutes?: number | null
          description?: string | null
          ingredients?: string[]
          notes?: string | null
          prep_time_minutes?: number | null
          rating?: number | null
          servings?: number | null
          source_url?: string | null
          steps?: string[]
          title?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: { name?: string }
        Relationships: []
      }
      recipe_tags: {
        Row: { recipe_id: string; tag_id: string }
        Insert: { recipe_id: string; tag_id: string }
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      get_recipe: {
        Args: { recipe_id: string }
        Returns: {
          cook_time_minutes: number | null
          created_at: string
          description: string | null
          id: string
          ingredients: string[]
          notes: string | null
          prep_time_minutes: number | null
          rank: number
          rating: number | null
          servings: number | null
          source_url: string | null
          steps: string[]
          tags: Json
          title: string
          updated_at: string
        }[]
      }
      ingredients_to_tsvector: {
        Args: { input: string[] }
        Returns: unknown
      }
      search_recipes: {
        Args: {
          query?: string | null
          result_limit?: number | null
          result_offset?: number | null
          tag_ids?: string[] | null
        }
        Returns: {
          cook_time_minutes: number | null
          created_at: string
          description: string | null
          id: string
          ingredients: string[]
          notes: string | null
          prep_time_minutes: number | null
          rank: number
          rating: number | null
          servings: number | null
          source_url: string | null
          steps: string[]
          tags: Json
          title: string
          updated_at: string
        }[]
      }
      set_updated_at: { Args: Record<PropertyKey, never>; Returns: unknown }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type RecipeRow = Database['public']['Tables']['recipes']['Row']
export type RecipeInsert = Database['public']['Tables']['recipes']['Insert']
export type RecipeUpdate = Database['public']['Tables']['recipes']['Update']
export type TagRow = Database['public']['Tables']['tags']['Row']

export type RecipeTag = { id: string; name: string }

/** Row shape returned by the search_recipes function. */
export type RecipeWithTags = Omit<RecipeRow, 'search_vector' | 'user_id'> & {
  rank: number
  tags: RecipeTag[]
}

/** The subset of recipe fields the editor owns, kept separate from db columns. */
export type RecipeDraft = {
  title: string
  description: string
  ingredients: string
  steps: string
  notes: string
  prep_time_minutes: string
  cook_time_minutes: string
  servings: string
  rating: string
  source_url: string
  tagNames: string[]
}