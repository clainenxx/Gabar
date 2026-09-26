import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

// Hook tunggal untuk seluruh app: kasih tahu siapa yang login (session) dan
// profilnya (dari tabel `profiles`). Dipakai oleh RequireRole dan halaman
// manapun yang perlu tahu identitas admin yang sedang login.
//
// GAGI cuma punya 1 role (`admin`, ARCHITECTURE.md §0.2) — beda dari AyamKu
// yang punya admin+kasir, jadi hook ini lebih sederhana (tidak perlu logic
// pembeda role di banyak tempat).
export function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    // Supabase langsung memanggil onAuthStateChange dengan event
    // INITIAL_SESSION begitu listener didaftarkan — nyaris bersamaan dengan
    // getSession() di init() di bawah. Kalau keduanya sama-sama dibiarkan
    // jalan, dua async task ini bisa saling menimpa state di urutan yang
    // tidak menentu. Solusi (pola yang sama dipakai di proyek asal AyamKu):
    // listener adalah satu-satunya sumber kebenaran untuk update SETELAH
    // initial load; init() cuma dipakai untuk initial load, dan listener
    // mengabaikan event pertamanya sendiri lewat flag ini.
    let initialLoadDone = false;

    async function loadProfile(userId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .eq("id", userId)
        .single();
      if (!error && mounted) setProfile(data);
    }

    async function applySession(current) {
      if (!mounted) return;
      setSession(current);
      if (current) {
        await loadProfile(current.user.id);
      } else {
        setProfile(null);
      }
    }

    async function init() {
      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      await applySession(current);
      initialLoadDone = true;
      if (mounted) setLoading(false);
    }

    init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => {
      if (!initialLoadDone) return;
      applySession(current);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { session, profile, loading, isLoggedIn: !!session };
}
