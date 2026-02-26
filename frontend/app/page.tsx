import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Users, Clock, Shield, TrendingUp, Zap } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-primary">
            Project Ops
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/auth/login">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link href="/auth/register">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-24 text-center">
        <div className="max-w-4xl mx-auto space-y-8">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            Project Management & Operations
            <span className="text-primary"> Made Powerful</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Streamline your projects, manage teams effectively, and track deliverables in real-time.
            Everything you need to run operations smoothly in one platform.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/auth/register">
              <Button size="lg" className="text-lg px-8">
                Start Free Trial
              </Button>
            </Link>
            <Link href="#features">
              <Button size="lg" variant="outline" className="text-lg px-8">
                Learn More
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="container mx-auto px-4 py-24 bg-muted/50">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">Everything You Need</h2>
          <p className="text-xl text-muted-foreground">
            Powerful features designed for modern project teams
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <FileText className="w-12 h-12 text-primary mb-2" />
              <CardTitle>Project Tracking</CardTitle>
              <CardDescription>
                Organize and track all your projects in one place with intuitive workflows and milestones
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Users className="w-12 h-12 text-primary mb-2" />
              <CardTitle>Team Collaboration</CardTitle>
              <CardDescription>
                Seamlessly collaborate with team members, assign tasks, and keep everyone aligned
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Clock className="w-12 h-12 text-primary mb-2" />
              <CardTitle>Real-time Updates</CardTitle>
              <CardDescription>
                Stay informed with instant notifications and live project status updates
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="w-12 h-12 text-primary mb-2" />
              <CardTitle>Secure & Compliant</CardTitle>
              <CardDescription>
                Enterprise-grade security with role-based access controls and audit trails
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <TrendingUp className="w-12 h-12 text-primary mb-2" />
              <CardTitle>Analytics Dashboard</CardTitle>
              <CardDescription>
                Track performance metrics, team velocity, and gain insights into your operations
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Zap className="w-12 h-12 text-primary mb-2" />
              <CardTitle>Automated Workflows</CardTitle>
              <CardDescription>
                Save time with smart automation, triggers, and customizable workflow templates
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-24">
        <Card className="max-w-4xl mx-auto bg-primary text-primary-foreground">
          <CardContent className="p-12 text-center">
            <h2 className="text-4xl font-bold mb-4">Ready to Supercharge Your Operations?</h2>
            <p className="text-xl mb-8 opacity-90">
              Join teams using Project Ops to deliver faster and collaborate better
            </p>
            <Link href="/auth/register">
              <Button size="lg" variant="secondary" className="text-lg px-8">
                Get Started Today
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 bg-muted/50">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>&copy; 2026 Project Ops by Magic Unicorn. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
