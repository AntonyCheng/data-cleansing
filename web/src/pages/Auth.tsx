import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { login, register } from "../lib/api";

export default function Auth({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!email.trim() || !password.trim()) {
      setError("请填写邮箱和密码。");
      return;
    }
    if (mode === "register" && !displayName.trim()) {
      setError("请填写昵称。");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password, displayName.trim());
      onAuthed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <a className="brand" href="#tasks">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path
                d="M8 7v18M24 7L13 16l11 9M13 11v10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            KData<small>STUDIO</small>
          </span>
        </a>
        <h1>{mode === "login" ? "登录工作区" : "创建账号"}</h1>
        <p className="auth-lede">
          {mode === "login" ? "登录后继续你的数据任务、清洗规则和数据服务。" : "创建账号后会自动生成一个全新的工作区。"}
        </p>
        {mode === "register" && (
          <label className="field">
            昵称
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="怎么称呼你"
              autoComplete="nickname"
            />
          </label>
        )}
        <label className="field">
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label className="field">
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "至少 6 位" : "••••••"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary auth-submit" disabled={busy} onClick={submit}>
          <Sparkles size={16} />
          {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
        </button>
        <button
          className="text-button auth-switch"
          onClick={() => {
            setMode((m) => (m === "login" ? "register" : "login"));
            setError("");
          }}
        >
          {mode === "login" ? "还没有账号？去注册" : "已有账号？去登录"}
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
