import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Radar } from "lucide-react";
import { toast } from "sonner";
import { clearSessionRole, setSessionRole, type AppRole } from "@/lib/role";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (mounted) {
        setUser(data.user);
        setLoading(false);
      }
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        setUser(session?.user ?? null);
        queryClient.invalidateQueries();
        void router.invalidate();
      } else if (event === "SIGNED_OUT") {
        setUser(null);
        queryClient.clear();
        void router.invalidate();
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient, router]);

  async function signOut() {
    clearSessionRole();
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
  }

  return <AuthContext.Provider value={{ user, loading, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthCard({
  message = "Sign in to scan streets and share reports on the live map.",
}: {
  message?: string;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [role, setRole] = useState<AppRole>("user");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || password.length < 6) {
      toast.error("Enter an email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin, data: { role } },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Check your email to confirm your account, then sign in.");
          return;
        }
      }
      setSessionRole(role);
      void supabase.auth.updateUser({ data: { role } });
      toast.success(role === "authority" ? "Signed in as municipal authority." : "Signed in.");
      if (role === "authority") void navigate({ to: "/authority" });
    } catch {
      toast.error(
        mode === "signin"
          ? "Sign-in failed. Check your email and password."
          : "Could not create the account.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Radar className="size-6" />
            <span className="font-bold tracking-tight">SadakSafe</span>
          </div>
          <CardTitle>{mode === "signin" ? "Sign in to continue" : "Create your account"}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={role === "user" ? "default" : "secondary"}
              onClick={() => setRole("user")}
            >
              User
            </Button>
            <Button
              type="button"
              variant={role === "authority" ? "default" : "secondary"}
              onClick={() => setRole("authority")}
            >
              Municipal authority
            </Button>
          </div>
          <Input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          <Button className="w-full" onClick={() => void submit()} disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setMode((current) => (current === "signin" ? "signup" : "signin"))}
          >
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
