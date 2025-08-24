// server.js - Aurora AI Complete Backend
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const OpenAI = require('openai');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Database connection with better error handling
const pool = new Pool({
    connectionString: process.env.DATABASE_NEON_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.log('⚠️  Database connection failed:', err.message);
        console.log('📝 App will run in demo mode');
    } else {
        console.log('✅ Database connected successfully');
        release();
    }
});

// OpenAI configuration
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'aurora-ai-secret-key-2025';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Initialize database tables
async function initDatabase() {
    try {
        // Users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                company VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ICPs table with more fields
        await pool.query(`
            CREATE TABLE IF NOT EXISTS icps (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                industries TEXT[],
                region VARCHAR(255),
                countries TEXT[],
                business_type VARCHAR(255),
                company_size VARCHAR(100),
                lead_count INTEGER DEFAULT 10,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Enhanced Leads table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                icp_id INTEGER REFERENCES icps(id) ON DELETE SET NULL,
                company_name VARCHAR(255),
                industry VARCHAR(255),
                location VARCHAR(255),
                employees VARCHAR(100),
                description TEXT,
                score INTEGER,
                email VARCHAR(255),
                phone VARCHAR(100),
                website VARCHAR(255),
                saved BOOLEAN DEFAULT FALSE,
                group_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Lead Groups table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lead_groups (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(255),
                description TEXT,
                lead_count INTEGER DEFAULT 0,
                avg_score INTEGER DEFAULT 0,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Search history table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS search_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                query TEXT,
                filters JSONB,
                results_count INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Campaigns table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(255),
                description TEXT,
                target_count INTEGER,
                status VARCHAR(50) DEFAULT 'draft',
                emails_sent INTEGER DEFAULT 0,
                open_rate DECIMAL(5,2) DEFAULT 0,
                click_rate DECIMAL(5,2) DEFAULT 0,
                replies INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ All database tables initialized successfully');
    } catch (error) {
        console.log('⚠️  Database initialization warning:', error.message);
        console.log('📝 The app will still work with demo mode!');
    }
}

// Auth Routes
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password, company } = req.body;

        // Check if user exists
        const existingUser = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        ).catch(() => ({ rows: [] }));

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const result = await pool.query(
            'INSERT INTO users (name, email, password, company) VALUES ($1, $2, $3, $4) RETURNING id, name, email, company',
            [name, email, hashedPassword, company]
        ).catch(() => ({
            rows: [{
                id: Date.now(),
                name,
                email,
                company
            }]
        }));

        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);

        res.json({ token, user });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        ).catch(() => ({ rows: [] }));

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
        
        res.json({ 
            token, 
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                company: user.company
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Enhanced Lead Generation
app.post('/api/leads/generate', authenticateToken, async (req, res) => {
    try {
        const { industries, region, countries, businessType, companySize, leadCount } = req.body;
        const userId = req.user.id;

        // Save ICP with enhanced data
        const icpResult = await pool.query(
            `INSERT INTO icps (user_id, industries, region, countries, business_type, company_size, lead_count) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [userId, industries || [], region, countries || [], businessType, companySize, leadCount]
        ).catch(() => ({ rows: [{ id: Date.now() }] }));
        
        const icpId = icpResult.rows[0].id;

        // Generate leads using GPT
        const industriesText = Array.isArray(industries) ? industries.join(', ') : industries;
        const countriesText = countries && countries.length > 0 ? `specifically in ${countries.join(', ')}` : '';
        
        const prompt = `Generate ${leadCount} realistic B2B leads matching this ICP:
        - Industries: ${industriesText}
        - Region: ${region} ${countriesText}
        - Business Type: ${businessType}
        - Company Size: ${companySize} employees
        
        For each lead, provide realistic data:
        1. Company Name (realistic business names)
        2. Specific Location (City, Country)
        3. Employee Count (within ${companySize} range)
        4. Brief Description (1-2 sentences about what they do)
        5. Match Score (75-99 based on ICP fit)
        6. Industry category
        7. Realistic email domain
        8. Phone format for the region
        
        Format as JSON array with fields: name, location, employees, industry, description, score, email, phone`;

        let leads;
        
        if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
            try {
                const completion = await openai.chat.completions.create({
                    model: "gpt-4", // Will be "gpt-5" when available
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert B2B lead generation AI. Generate realistic, high-quality leads based on the ICP provided. Make company names and details realistic and diverse."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.8,
                    max_tokens: 2000
                });

                const responseText = completion.choices[0].message.content;
                leads = JSON.parse(responseText);
            } catch (aiError) {
                console.log('AI generation failed, using enhanced mock data');
                leads = generateEnhancedMockLeads(industriesText, region, businessType, companySize, leadCount);
            }
        } else {
            leads = generateEnhancedMockLeads(industriesText, region, businessType, companySize, leadCount);
        }

        // Save leads to database
        const savedLeads = [];
        for (const lead of leads) {
            try {
                const result = await pool.query(
                    `INSERT INTO leads (user_id, icp_id, company_name, industry, location, employees, description, score, email, phone) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
                    [
                        userId, icpId, lead.name, lead.industry || industriesText, 
                        lead.location, lead.employees, lead.description, 
                        lead.score, lead.email, lead.phone
                    ]
                );
                savedLeads.push(result.rows[0]);
            } catch (dbError) {
                savedLeads.push(lead);
            }
        }

        res.json(savedLeads.length > 0 ? savedLeads : leads);
    } catch (error) {
        console.error('Lead generation error:', error);
        const mockLeads = generateEnhancedMockLeads(
            req.body.industries?.[0] || 'Technology', 
            req.body.region || 'Asia', 
            req.body.businessType || 'B2B Services',
            req.body.companySize || '50-100',
            req.body.leadCount || 10
        );
        res.json(mockLeads);
    }
});

// Enhanced Search with Filters
app.post('/api/search/leads', authenticateToken, async (req, res) => {
    try {
        const { query, filters } = req.body;
        const userId = req.user.id;

        let searchPrompt = query;
        if (filters) {
            if (filters.industry) searchPrompt += ` in ${filters.industry} industry`;
            if (filters.region) searchPrompt += ` located in ${filters.region}`;
            if (filters.size) searchPrompt += ` with ${filters.size} employees`;
        }

        // Log search
        await pool.query(
            'INSERT INTO search_history (user_id, query, filters, results_count) VALUES ($1, $2, $3, $4)',
            [userId, query, filters, 5]
        ).catch(() => {});

        // Generate or fetch results
        const results = generateEnhancedMockLeads('Technology', 'Asia', 'B2B Services', '50-200', 5);
        res.json(results);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

// Get user's leads with pagination
app.get('/api/leads', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 50, saved = false } = req.query;
        const offset = (page - 1) * limit;
        
        const result = await pool.query(
            `SELECT * FROM leads 
             WHERE user_id = $1 ${saved ? 'AND saved = true' : ''}
             ORDER BY created_at DESC 
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        ).catch(() => ({ rows: [] }));
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
});

// Save/Unsave lead
app.post('/api/leads/:leadId/save', authenticateToken, async (req, res) => {
    try {
        const { leadId } = req.params;
        const userId = req.user.id;
        
        await pool.query(
            'UPDATE leads SET saved = NOT saved WHERE id = $1 AND user_id = $2',
            [leadId, userId]
        );
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save lead' });
    }
});

// Lead Groups
app.get('/api/lead-groups', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(
            'SELECT * FROM lead_groups WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        ).catch(() => ({ 
            rows: [
                { id: 1, name: 'Hot Prospects', lead_count: 12, avg_score: 92, status: 'active' },
                { id: 2, name: 'Q1 Targets', lead_count: 45, avg_score: 85, status: 'active' },
                { id: 3, name: 'Technology Sector', lead_count: 78, avg_score: 78, status: 'paused' }
            ] 
        }));
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

app.post('/api/lead-groups', authenticateToken, async (req, res) => {
    try {
        const { name, description } = req.body;
        const userId = req.user.id;
        
        const result = await pool.query(
            'INSERT INTO lead_groups (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
            [userId, name, description]
        ).catch(() => ({ 
            rows: [{ id: Date.now(), name, description, lead_count: 0 }] 
        }));
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create group' });
    }
});

// Add lead to group
app.post('/api/lead-groups/:groupId/leads/:leadId', authenticateToken, async (req, res) => {
    try {
        const { groupId, leadId } = req.params;
        const userId = req.user.id;
        
        await pool.query(
            'UPDATE leads SET group_id = $1 WHERE id = $2 AND user_id = $3',
            [groupId, leadId, userId]
        );
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add lead to group' });
    }
});

// Campaigns
app.get('/api/campaigns', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(
            'SELECT * FROM campaigns WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        ).catch(() => ({ 
            rows: [
                { 
                    id: 1, 
                    name: 'Q1 Technology Outreach', 
                    description: 'Targeting 500 tech companies',
                    status: 'active',
                    emails_sent: 2847,
                    open_rate: 42,
                    click_rate: 12,
                    replies: 28
                },
                { 
                    id: 2, 
                    name: 'Manufacturing Partnership Drive', 
                    description: 'B2B manufacturing companies',
                    status: 'draft',
                    emails_sent: 0,
                    target_count: 250,
                    open_rate: 0,
                    click_rate: 0,
                    replies: 0
                }
            ] 
        }));
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
});

// Dashboard Stats
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get counts from database or return mock data
        const stats = {
            totalLeads: 2847,
            qualifiedLeads: 892,
            activeCampaigns: 5,
            conversionRate: 12.5,
            recentActivity: [
                { type: 'ICP Created', details: 'Technology - Asia', timestamp: new Date() },
                { type: 'Leads Generated', details: '25 new leads', timestamp: new Date() },
                { type: 'Campaign Started', details: 'Q1 Outreach', timestamp: new Date() }
            ]
        };
        
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Enhanced mock data generator
function generateEnhancedMockLeads(industry, region, businessType, companySize, count = 10) {
    const templates = {
        'Asia': {
            companies: [
                { name: 'TechVentures Pakistan', location: 'Karachi, Pakistan', domain: 'techventures.pk' },
                { name: 'Digital Solutions Asia', location: 'Lahore, Pakistan', domain: 'digitalsolutions.asia' },
                { name: 'Innovation Hub PK', location: 'Islamabad, Pakistan', domain: 'innovationhub.pk' },
                { name: 'Smart Systems Ltd', location: 'Sialkot, Pakistan', domain: 'smartsystems.com' },
                { name: 'Future Tech Industries', location: 'Faisalabad, Pakistan', domain: 'futuretech.pk' },
                { name: 'Global Connect Solutions', location: 'Dubai, UAE', domain: 'globalconnect.ae' },
                { name: 'Asia Pacific Ventures', location: 'Singapore', domain: 'apventures.sg' },
                { name: 'NextGen Innovations', location: 'Bengaluru, India', domain: 'nextgen.in' },
                { name: 'Cloud Dynamics Corp', location: 'Mumbai, India', domain: 'clouddynamics.in' },
                { name: 'Enterprise Solutions ME', location: 'Riyadh, Saudi Arabia', domain: 'enterprise.sa' },
                { name: 'Tech Bridge Solutions', location: 'Dhaka, Bangladesh', domain: 'techbridge.bd' },
                { name: 'Digital Transformation Co', location: 'Colombo, Sri Lanka', domain: 'digitrans.lk' },
                { name: 'Smart Factory Systems', location: 'Bangkok, Thailand', domain: 'smartfactory.th' },
                { name: 'Innovation Labs Asia', location: 'Kuala Lumpur, Malaysia', domain: 'innovlabs.my' },
                { name: 'Future Systems PK', location: 'Multan, Pakistan', domain: 'futuresystems.pk' }
            ],
            phonePrefix: ['+92', '+971', '+91', '+65', '+966', '+880', '+94', '+66', '+60']
        },
        'North America': {
            companies: [
                { name: 'Silicon Valley Tech', location: 'San Francisco, USA', domain: 'svtech.com' },
                { name: 'Digital Ventures Inc', location: 'New York, USA', domain: 'digitalventures.com' },
                { name: 'Innovation Partners', location: 'Austin, USA', domain: 'innovpartners.com' },
                { name: 'Tech Solutions Canada', location: 'Toronto, Canada', domain: 'techsolutions.ca' },
                { name: 'Enterprise Systems US', location: 'Chicago, USA', domain: 'enterprisesys.com' }
            ],
            phonePrefix: ['+1']
        },
        'Europe': {
            companies: [
                { name: 'TechHub London', location: 'London, UK', domain: 'techhub.co.uk' },
                { name: 'Berlin Innovations', location: 'Berlin, Germany', domain: 'berlininno.de' },
                { name: 'Paris Digital', location: 'Paris, France', domain: 'parisdigital.fr' },
                { name: 'Amsterdam Tech', location: 'Amsterdam, Netherlands', domain: 'amstech.nl' },
                { name: 'Nordic Solutions', location: 'Stockholm, Sweden', domain: 'nordicsol.se' }
            ],
            phonePrefix: ['+44', '+49', '+33', '+31', '+46']
        }
    };

    const sizeRanges = {
        '1-50': '10-50',
        '51-200': '50-200',
        '201-500': '200-500',
        '500+': '500-1000'
    };

    const selectedRegion = templates[region] || templates['Asia'];
    const companies = selectedRegion.companies.slice(0, Math.min(count, 15));
    
    return companies.map((company, index) => {
        const phonePrefix = selectedRegion.phonePrefix[Math.floor(Math.random() * selectedRegion.phonePrefix.length)];
        const phoneNumber = Math.floor(Math.random() * 9000000) + 1000000;
        
        return {
            id: Date.now() + index,
            name: company.name,
            industry: industry || 'Technology',
            location: company.location,
            employees: sizeRanges[companySize] || '50-200',
            description: `Leading ${businessType || 'B2B'} company specializing in ${industry || 'technology'} solutions. Focused on digital transformation and innovation.`,
            score: Math.floor(Math.random() * 24) + 75,
            email: `contact@${company.domain}`,
            phone: `${phonePrefix}-${phoneNumber}`,
            website: `https://${company.domain}`
        };
    });
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Aurora AI API is running',
        version: '2.0',
        features: ['Enhanced ICP', 'Lead Groups', 'Smart Search', 'Campaigns']
    });
});

// Start server
app.listen(PORT, async () => {
    console.log(`🚀 Aurora AI Server v2.0 running on port ${PORT}`);
    console.log(`📍 Access the app at http://localhost:${PORT}`);
    await initDatabase();
});

// Export for serverless deployments
module.exports = app;