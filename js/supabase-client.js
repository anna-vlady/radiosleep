/* ==========================================================================
   RADIOSLEEP — Supabase Cloud Archive Integration Module
   ========================================================================== */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Configurable Supabase credentials (can be set via window variables or updated directly)
export const SUPABASE_CONFIG = {
  url: window.RADIOSLEEP_SUPABASE_URL || 'https://wkcvgotagqfykngvuiar.supabase.co',
  anonKey: window.RADIOSLEEP_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrY3Znb3RhZ3FmeWtuZ3Z1aWFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MjkwNjQsImV4cCI6MjEwMTAwNTA2NH0.UpWupUs0C_hyEJ2weRbhzjLU_nFpamZa1PDmz322dWg',
  bucketName: 'radiosleep_recordings',
  tableName: 'raw_recordings'
};

let supabaseClient = null;

/**
 * Initializes or retrieves active Supabase Client
 */
export function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  
  const url = window.RADIOSLEEP_SUPABASE_URL || SUPABASE_CONFIG.url;
  const key = window.RADIOSLEEP_SUPABASE_KEY || SUPABASE_CONFIG.anonKey;

  if (url && key && !url.includes('YOUR_SUPABASE_PROJECT')) {
    try {
      supabaseClient = createClient(url, key);
      console.log('☁️ Supabase Cloud Storage Connected:', url);
    } catch (err) {
      console.warn('Supabase client init warning:', err);
    }
  }
  return supabaseClient;
}

export function isSupabaseConnected() {
  return getSupabaseClient() !== null;
}

/**
 * Uploads raw audio Blob and metadata to Supabase Cloud Bucket & Table
 */
export async function uploadToSupabaseCloud(recordItem) {
  const supabase = getSupabaseClient();
  if (!supabase || !recordItem) return null;

  try {
    const fileName = `${recordItem.name}.wav`; // Uses dream01.wav, dream02.wav naming convention!
    const filePath = fileName; // Saves directly inside radiosleep_recordings bucket root!

    // 1. Upload raw audio file blob to Supabase Storage Bucket
    const { data: storageData, error: storageError } = await supabase.storage
      .from(SUPABASE_CONFIG.bucketName)
      .upload(filePath, recordItem.blob || new Blob(), {
        contentType: 'audio/wav',
        upsert: true
      });

    if (storageError) throw storageError;

    // 2. Get Public URL for the uploaded audio file
    const { data: publicUrlData } = supabase.storage
      .from(SUPABASE_CONFIG.bucketName)
      .getPublicUrl(filePath);

    const publicUrl = publicUrlData ? publicUrlData.publicUrl : '';

    // 3. Insert recording metadata into Supabase Database Table
    const { data: dbData, error: dbError } = await supabase
      .from(SUPABASE_CONFIG.tableName)
      .upsert({
        id: recordItem.id,
        name: recordItem.name,
        color: recordItem.color,
        timestamp: recordItem.timestamp,
        duration: recordItem.duration,
        audio_url: publicUrl
      });

    if (dbError) throw dbError;

    console.log('☁️ Successfully saved to Supabase Cloud:', recordItem.name);
    return { publicUrl, storagePath: filePath };
  } catch (err) {
    console.warn('Supabase cloud upload notice (Saved locally to IndexedDB):', err.message || err);
    return null;
  }
}

/**
 * Fetches all raw recordings from Supabase Database Table
 */
export async function fetchFromSupabaseCloud() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(SUPABASE_CONFIG.tableName)
      .select('*')
      .order('timestamp', { ascending: true });

    if (error) throw error;
    return data;
  } catch (err) {
    console.warn('Supabase cloud fetch notice:', err.message || err);
    return null;
  }
}
