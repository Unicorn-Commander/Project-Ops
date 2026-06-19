"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  Server,
  Lock,
  Eye,
  EyeOff,
  Send,
  CheckCircle,
  XCircle,
  AlertCircle,
  Copy,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import {
  getEmailConfig,
  updateEmailConfig,
  sendTestEmail,
  deleteEmailConfig,
  SMTP_PROVIDERS,
  EmailConfigResponse,
} from "@/lib/email-api";
import {
  emailConfigSchema,
  EmailConfigFormData,
} from "@/lib/email-validation";
import { useRouter } from "next/navigation";

export default function EmailSettingsPage() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [config, setConfig] = useState<EmailConfigResponse | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<EmailConfigFormData>({
    resolver: zodResolver(emailConfigSchema),
    defaultValues: {
      provider: "microsoft365",
      smtpHost: SMTP_PROVIDERS.microsoft365.host,
      smtpPort: SMTP_PROVIDERS.microsoft365.port,
      useTLS: true,
      email: "",
      password: "",
      fromName: "Project Ops",
      enabled: true,
    },
  });

  const selectedProvider = watch("provider");
  const useTLS = watch("useTLS");
  const enabled = watch("enabled");

  // Check if user is admin
  useEffect(() => {
    if (user && user.role !== "ADMIN") {
      toast({
        title: "Access Denied",
        description: "Only administrators can access email settings",
        variant: "destructive",
      });
      router.push("/dashboard");
    }
  }, [user, router, toast]);

  // Load existing configuration
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const data = await getEmailConfig();
        if (data) {
          setConfig(data);
          setValue("provider", data.provider as any);
          setValue("smtpHost", data.smtpHost);
          setValue("smtpPort", data.smtpPort);
          setValue("useTLS", data.useTLS);
          setValue("email", data.email);
          setValue("fromName", data.fromName);
          setValue("enabled", data.enabled);
          setTestRecipient(user?.email || "");
        } else {
          setTestRecipient(user?.email || "");
        }
      } catch (error) {
        console.error("Failed to load email config:", error);
      }
    };
    if (user?.role === "ADMIN") {
      loadConfig();
    }
  }, [user, setValue]);

  // Update SMTP settings when provider changes
  useEffect(() => {
    if (selectedProvider && SMTP_PROVIDERS[selectedProvider]) {
      const provider = SMTP_PROVIDERS[selectedProvider];
      setValue("smtpHost", provider.host);
      setValue("smtpPort", provider.port);
      setValue("useTLS", provider.useTLS);
    }
  }, [selectedProvider, setValue]);

  const onSubmit = async (data: EmailConfigFormData) => {
    setLoading(true);
    try {
      const updatedConfig = await updateEmailConfig(data);
      setConfig(updatedConfig);
      toast({
        title: "Success",
        description: "Email configuration saved successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to save configuration",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testRecipient) {
      toast({
        title: "Error",
        description: "Please enter a recipient email address",
        variant: "destructive",
      });
      return;
    }

    setTestingEmail(true);
    try {
      const result = await sendTestEmail(testRecipient);
      toast({
        title: "Success",
        description: `Test email sent successfully to ${testRecipient}`,
      });
      // Reload config to get updated test status
      const updatedConfig = await getEmailConfig();
      if (updatedConfig) setConfig(updatedConfig);
    } catch (error: any) {
      toast({
        title: "Test Failed",
        description: error.response?.data?.message || "Failed to send test email",
        variant: "destructive",
      });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete the email configuration?")) {
      return;
    }

    setLoading(true);
    try {
      await deleteEmailConfig();
      setConfig(null);
      toast({
        title: "Success",
        description: "Email configuration deleted",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to delete configuration",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Text copied to clipboard",
    });
  };

  const maskPassword = (password: string) => {
    if (!password || password.length < 4) return "****";
    return password.substring(0, 4) + "*".repeat(password.length - 4);
  };

  if (user?.role !== "ADMIN") {
    return null;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Email Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure SMTP settings for sending emails from Project Ops
        </p>
      </div>

      {/* Current Status */}
      {config && (
        <Card className="p-4 bg-muted/50">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {config.enabled ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="font-medium">Email Configured</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-orange-500" />
                    <span className="font-medium">Email Disabled</span>
                  </>
                )}
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  <strong>Email:</strong> {config.email}
                </p>
                <p>
                  <strong>SMTP:</strong> {config.smtpHost}:{config.smtpPort}
                </p>
                <p>
                  <strong>Password:</strong> {maskPassword(config.password)}
                </p>
                {config.lastTestAt && (
                  <p className="flex items-center gap-2">
                    <strong>Last Test:</strong>
                    {config.lastTestStatus === "success" ? (
                      <span className="text-green-500 flex items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        Success
                      </span>
                    ) : (
                      <span className="text-red-500 flex items-center gap-1">
                        <XCircle className="h-4 w-4" />
                        Failed
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {new Date(config.lastTestAt).toLocaleString()}
                    </span>
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={loading}
            >
              Delete Config
            </Button>
          </div>
        </Card>
      )}

      {/* Setup Instructions */}
      <Card className="p-6">
        <button
          onClick={() => setShowInstructions(!showInstructions)}
          aria-expanded={showInstructions}
          aria-controls="setup-instructions"
          className="flex items-center justify-between w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Setup Instructions</h2>
          </div>
          {showInstructions ? (
            <ChevronUp className="h-5 w-5" aria-hidden />
          ) : (
            <ChevronDown className="h-5 w-5" aria-hidden />
          )}
        </button>

        {showInstructions && (
          <div id="setup-instructions" className="mt-6 space-y-6">
            {/* Security Notice */}
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-700 rounded-lg p-4">
              <div className="flex gap-3">
                <Lock className="h-5 w-5 text-orange-600 dark:text-orange-300 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-orange-900 dark:text-orange-200 mb-2">
                    Security Notice
                  </p>
                  <p className="text-orange-800 dark:text-orange-100 leading-relaxed">
                    Never use your regular email password. Always generate an
                    app-specific password from your email provider. App passwords
                    are designed for third-party applications and can be revoked
                    without changing your main password.
                  </p>
                </div>
              </div>
            </div>

            {/* Microsoft 365 Instructions */}
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="font-semibold text-lg mb-3 flex items-center gap-2 text-foreground">
                <Server className="h-5 w-5 text-primary" />
                Microsoft 365 / Outlook
              </h3>
              <ol className="list-decimal list-inside space-y-2.5 text-sm text-foreground/80">
                <li className="leading-relaxed">
                  Go to{" "}
                  <a
                    href={SMTP_PROVIDERS.microsoft365.setupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1 font-medium rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Microsoft Account Security
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li className="leading-relaxed">Navigate to Security → Advanced security options</li>
                <li className="leading-relaxed">Select "App passwords" and create a new app password</li>
                <li className="leading-relaxed">Copy the generated password and paste it below</li>
                <li className="leading-relaxed">
                  Use <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">smtp.office365.com</code> as
                  SMTP host
                </li>
              </ol>
            </div>

            {/* Google Workspace Instructions */}
            <div className="border rounded-lg p-4 bg-card">
              <h3 className="font-semibold text-lg mb-3 flex items-center gap-2 text-foreground">
                <Mail className="h-5 w-5 text-primary" />
                Google Workspace / Gmail
              </h3>
              <ol className="list-decimal list-inside space-y-2.5 text-sm text-foreground/80">
                <li className="leading-relaxed">Enable 2-Step Verification on your Google account</li>
                <li className="leading-relaxed">
                  Go to{" "}
                  <a
                    href={SMTP_PROVIDERS.google.setupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1 font-medium rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Google App Passwords
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li className="leading-relaxed">Select "Mail" as the app and your device</li>
                <li className="leading-relaxed">Copy the 16-character password generated</li>
                <li className="leading-relaxed">
                  Use <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">smtp.gmail.com</code> as SMTP
                  host
                </li>
              </ol>
            </div>

            {/* HTTPS Notice */}
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">
                    HTTPS Required
                  </p>
                  <p className="text-blue-700 dark:text-blue-400">
                    For security, email configuration is only available over HTTPS
                    connections. Your password is encrypted in transit and at rest.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Email Configuration Form */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <Server className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">SMTP Configuration</h2>
          </div>

          <div className="space-y-6">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label htmlFor="provider">Email Provider</Label>
              <Select
                value={selectedProvider}
                onValueChange={(value) => setValue("provider", value as any)}
              >
                <SelectTrigger
                  id="provider"
                  aria-invalid={!!errors.provider}
                  aria-describedby={errors.provider ? "provider-error" : undefined}
                >
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="microsoft365">Microsoft 365 / Outlook</SelectItem>
                  <SelectItem value="google">Google Workspace / Gmail</SelectItem>
                  <SelectItem value="custom">Custom SMTP Server</SelectItem>
                </SelectContent>
              </Select>
              {errors.provider && (
                <p id="provider-error" className="text-sm text-red-500">{errors.provider.message}</p>
              )}
            </div>

            {/* SMTP Host */}
            <div className="space-y-2">
              <Label htmlFor="smtpHost">SMTP Host</Label>
              <Input
                id="smtpHost"
                {...register("smtpHost")}
                placeholder="smtp.example.com"
                aria-invalid={!!errors.smtpHost}
                aria-describedby={errors.smtpHost ? "smtpHost-error" : undefined}
              />
              {errors.smtpHost && (
                <p id="smtpHost-error" className="text-sm text-red-500">{errors.smtpHost.message}</p>
              )}
            </div>

            {/* SMTP Port and TLS */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="smtpPort">SMTP Port</Label>
                <Input
                  id="smtpPort"
                  type="number"
                  {...register("smtpPort", { valueAsNumber: true })}
                  placeholder="587"
                  aria-invalid={!!errors.smtpPort}
                  aria-describedby={errors.smtpPort ? "smtpPort-error" : undefined}
                />
                {errors.smtpPort && (
                  <p id="smtpPort-error" className="text-sm text-red-500">{errors.smtpPort.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="useTLS">Use TLS/STARTTLS</Label>
                <div className="flex items-center gap-3 h-10">
                  <Switch
                    id="useTLS"
                    checked={useTLS}
                    onCheckedChange={(checked) => setValue("useTLS", checked)}
                    aria-label="Use TLS or STARTTLS"
                  />
                  <span className="text-sm text-muted-foreground">
                    {useTLS ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
            </div>

            {/* Email Address */}
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                {...register("email")}
                placeholder="your-email@company.com"
                aria-invalid={!!errors.email}
                aria-describedby={
                  errors.email ? "email-error" : "email-hint"
                }
              />
              {errors.email && (
                <p id="email-error" className="text-sm text-red-500">{errors.email.message}</p>
              )}
              <p id="email-hint" className="text-sm text-muted-foreground">
                The email address used to send emails
              </p>
            </div>

            {/* App Password */}
            <div className="space-y-2">
              <Label htmlFor="password">App Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  {...register("password")}
                  placeholder="Enter app-specific password"
                  className="pr-10"
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    errors.password ? "password-error" : "password-hint"
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="text-sm text-red-500">{errors.password.message}</p>
              )}
              <p id="password-hint" className="text-sm text-muted-foreground">
                Use an app-specific password, not your regular email password
              </p>
            </div>

            {/* From Name */}
            <div className="space-y-2">
              <Label htmlFor="fromName">From Name</Label>
              <Input
                id="fromName"
                {...register("fromName")}
                placeholder="Project Ops"
                aria-invalid={!!errors.fromName}
                aria-describedby={errors.fromName ? "fromName-error" : "fromName-hint"}
              />
              {errors.fromName && (
                <p id="fromName-error" className="text-sm text-red-500">{errors.fromName.message}</p>
              )}
              <p id="fromName-hint" className="text-sm text-muted-foreground">
                The name that appears in the "From" field of sent emails
              </p>
            </div>

            {/* Enable/Disable */}
            <div className="flex items-center justify-between border-t pt-6">
              <div>
                <Label htmlFor="email-enabled" className="font-medium cursor-pointer">
                  Enable Email Sending
                </Label>
                <p className="text-sm text-muted-foreground">
                  Turn email notifications on or off
                </p>
              </div>
              <Switch
                id="email-enabled"
                checked={enabled}
                onCheckedChange={(checked) => setValue("enabled", checked)}
                aria-label="Enable email sending"
              />
            </div>

            {/* Save Button */}
            <Button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90"
              disabled={loading}
            >
              {loading ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </Card>
      </form>

      {/* Test Email Section */}
      {config && (
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <Send className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Test Email</h2>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="testRecipient">Recipient Email</Label>
              <Input
                id="testRecipient"
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder="recipient@example.com"
              />
              <p className="text-sm text-muted-foreground">
                Send a test email to verify your configuration
              </p>
            </div>

            <Button
              onClick={handleTestEmail}
              disabled={testingEmail || !config.enabled}
              className="w-full"
            >
              {testingEmail ? (
                <>Sending Test Email...</>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Test Email
                </>
              )}
            </Button>

            {!config.enabled && (
              <p className="text-sm text-orange-600 dark:text-orange-400">
                Email sending is currently disabled. Enable it above to send test
                emails.
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
