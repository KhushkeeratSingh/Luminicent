import fs from "fs";
import path from "path";
import Docker from "dockerode";

const docker = new Docker();

/**
 * Production Readiness Analyzer
 * Checks Docker image, Dockerfile and project structure
 */

export async function analyzeProduction(
    buildContext,
    imageName,
    container = null
) {

    const report = {
        score: 100,
        status: "PASS",
        issues: [],
        recommendations: [],
        runtime: {},
        docker: {},
        security: {},
        project: {}
    };

    //---------------------------------------------------
    // Helper
    //---------------------------------------------------

    const addIssue = (severity, title, description, recommendation) => {

        report.issues.push({
            severity,
            title,
            description,
            recommendation
        });

        report.recommendations.push(recommendation);

        switch (severity) {

            case "Critical":
                report.score -= 20;
                break;

            case "High":
                report.score -= 15;
                break;

            case "Medium":
                report.score -= 10;
                break;

            case "Low":
                report.score -= 5;
                break;
        }
    };

    //---------------------------------------------------
    // Files
    //---------------------------------------------------

    const dockerfilePath = path.join(buildContext, "Dockerfile");

    const dockerignorePath = path.join(buildContext, ".dockerignore");

    const envPath = path.join(buildContext, ".env");

    const envExample = path.join(buildContext, ".env.example");

    //---------------------------------------------------
    // Dockerfile Exists
    //---------------------------------------------------

    if (!fs.existsSync(dockerfilePath)) {

        addIssue(
            "Critical",
            "Dockerfile Missing",
            "Project has no Dockerfile.",
            "Create a production Dockerfile."
        );

        return report;
    }

    //---------------------------------------------------
    // Read Dockerfile
    //---------------------------------------------------

    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");

    //---------------------------------------------------
    // Dockerignore
    //---------------------------------------------------

    if (!fs.existsSync(dockerignorePath)) {

        addIssue(
            "Medium",
            ".dockerignore Missing",
            "Docker will copy unnecessary files.",
            "Create a .dockerignore file."
        );

    } else {

        report.project.dockerignore = true;

        // Check .dockerignore contents
        const ignore = fs.readFileSync(dockerignorePath, "utf8");

        if (!ignore.includes("node_modules")) {

            addIssue(
                "Medium",
                ".dockerignore Incomplete",
                "node_modules isn't ignored.",
                "Add node_modules to .dockerignore."
            );
        }
    }

    //---------------------------------------------------
    // Environment File
    //---------------------------------------------------

    if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {

        addIssue(
            "Medium",
            ".env Missing",
            ".env.example exists but .env is missing.",
            "Create a production .env file."
        );
    }

    //---------------------------------------------------
    // USER check
    //---------------------------------------------------

    if (!dockerfile.includes("USER")) {

        addIssue(
            "High",
            "Container Runs As Root",
            "Running containers as root is insecure.",
            "Add USER node or a non-root user."
        );
    }

    //---------------------------------------------------
    // HEALTHCHECK
    //---------------------------------------------------

    if (!dockerfile.includes("HEALTHCHECK")) {

        addIssue(
            "Medium",
            "Missing HEALTHCHECK",
            "Container has no health monitoring.",
            "Add a HEALTHCHECK instruction."
        );
    }

    //---------------------------------------------------
    // Multi-stage Build
    //---------------------------------------------------

    const fromCount = (dockerfile.match(/FROM/g) || []).length;

    if (fromCount < 2) {

        addIssue(
            "Low",
            "Single Stage Build",
            "Image can be optimized.",
            "Use multi-stage Docker builds."
        );
    }

    //---------------------------------------------------
    // Latest Tag
    //---------------------------------------------------

    if (dockerfile.includes(":latest")) {

        addIssue(
            "Medium",
            "Latest Tag Used",
            "Using latest image tag is risky.",
            "Use a fixed version."
        );
    }

    //---------------------------------------------------
    // npm install
    //---------------------------------------------------

    if (
        dockerfile.includes("npm install") &&
        !dockerfile.includes("npm ci")
    ) {

        addIssue(
            "Low",
            "npm install Used",
            "npm ci is recommended for production.",
            "Replace npm install with npm ci."
        );
    }

    //---------------------------------------------------
    // Image Information
    //---------------------------------------------------

    try {

        // Verify the image exists using Docker API
        const images = await docker.listImages();

        const imageExists = images.find(img =>
            (img.RepoTags || []).includes(`${imageName}:latest`)
        );

        if (!imageExists) {
            throw new Error(`Docker image ${imageName}:latest not found`);
        }

        const image = docker.getImage(imageName);

        const inspect = await image.inspect();

        report.docker.imageId = inspect.Id;
        report.docker.sizeMB = (inspect.Size / 1024 / 1024).toFixed(2);
        report.docker.created = inspect.Created;

        console.log("Production Analyzer: Image Found");
        console.log("Image ID:", inspect.Id);

        report.project.path = buildContext;
        report.project.dockerfile = fs.existsSync(dockerfilePath);
        report.project.envExample = fs.existsSync(envExample);
        report.project.env = fs.existsSync(envPath);

        if (inspect.Size > 700 * 1024 * 1024) {
            addIssue(
                "Medium",
                "Large Docker Image",
                `Image size is ${report.docker.sizeMB} MB`,
                "Reduce image size using Alpine and multi-stage builds."
            );
        }

    } catch (err) {

        console.error("Image inspect failed:", err.message);

        addIssue(
            "Critical",
            "Image Inspect Failed",
            err.message,
            "Verify image creation."
        );
    }

    //---------------------------------------------------
    // Runtime
    //---------------------------------------------------

    if (container) {

        try {

            const inspect = await container.inspect();

            report.runtime.running = inspect.State.Running;

            report.runtime.status = inspect.State.Status;

            report.runtime.startedAt = inspect.State.StartedAt;

            report.runtime.exitCode = inspect.State.ExitCode;

        } catch (err) {

            addIssue(
                "Medium",
                "Runtime Inspection Failed",
                err.message,
                "Inspect container manually."
            );
        }
    }

    //---------------------------------------------------
    // Secret Scanner
    //---------------------------------------------------

    const secretPatterns = [
        /API_KEY\s*=/i,
        /SECRET\s*=/i,
        /TOKEN\s*=/i,
        /PASSWORD\s*=/i,
        /ACCESS_KEY\s*=/i,
        /PRIVATE_KEY\s*=/i,
        /AWS_SECRET_ACCESS_KEY/i,
        /MONGO_URI/i,
        /JWT_SECRET/i
    ];

    const scanFolder = (dir) => {

        let files = [];

        try {
            files = fs.readdirSync(dir);
        } catch {
            return;
        }

        for (const file of files) {

            if (
                file === "node_modules" ||
                file === ".git" ||
                file === "__MACOSX" ||
                file === "dist" ||
                file === "build"
            ) {
                continue;
            }

            const full = path.join(dir, file);

            let stat;

            try {
                stat = fs.statSync(full);
            } catch {
                continue;
            }

            if (stat.isDirectory()) {

                scanFolder(full);

            } else {

                try {

                    const content = fs.readFileSync(full, "utf8");

                    for (const pattern of secretPatterns) {

                        if (pattern.test(content)) {

                            addIssue(
                                "Critical",
                                "Hardcoded Secret",
                                `${pattern} found in ${file}`,
                                "Move secrets into environment variables."
                            );

                            break;
                        }
                    }

                } catch {
                    // Ignore binary or unreadable files
                }
            }
        }
    };

    scanFolder(buildContext);

    //---------------------------------------------------
    // Project Checks
    //---------------------------------------------------

    const nodeModules = path.join(buildContext, "node_modules");

    if (fs.existsSync(nodeModules)) {

        addIssue(
            "Low",
            "node_modules Included",
            "Project contains node_modules.",
            "Use .dockerignore to exclude node_modules."
        );
    }

    const readme = path.join(buildContext, "README.md");

    if (!fs.existsSync(readme)) {

        addIssue(
            "Low",
            "README Missing",
            "Project documentation is missing.",
            "Add a README.md."
        );
    }

    // Check lock file for Node projects
    const packageLock = path.join(buildContext, "package-lock.json");

    if (!fs.existsSync(packageLock)) {

        addIssue(
            "Low",
            "Lock File Missing",
            "Dependencies are not locked.",
            "Commit package-lock.json."
        );
    }

    //---------------------------------------------------
    // Final Status
    //---------------------------------------------------

    if (report.score >= 90)
        report.status = "Excellent";

    else if (report.score >= 75)
        report.status = "Good";

    else if (report.score >= 60)
        report.status = "Needs Improvement";

    else
        report.status = "Poor";

    // Remove duplicate recommendations
    report.recommendations = [...new Set(report.recommendations)];

    // Prevent score from going below 0
    report.score = Math.max(0, report.score);

    // Generate summary counts for frontend display
    report.summary = {
        critical: report.issues.filter(i => i.severity === "Critical").length,
        high: report.issues.filter(i => i.severity === "High").length,
        medium: report.issues.filter(i => i.severity === "Medium").length,
        low: report.issues.filter(i => i.severity === "Low").length
    };

    // Add timestamp
    report.generatedAt = new Date().toISOString();

    return report;
}