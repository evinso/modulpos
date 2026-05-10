const express = require('express');
const router = express.Router();
const prisma = require('../config/database');

// Get landing page pricing plans
router.get('/pricing-plans', async (req, res) => {
  try {
    const plans = await prisma.$queryRawUnsafe(`SELECT *, "yearlyPrice" FROM "LandingPricingPlan" WHERE "isActive" = true ORDER BY "order" ASC`);
    const formattedPlans = plans.map(p => ({
      ...p,
      features: JSON.parse(p.features || '[]')
    }));
    res.json(formattedPlans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get landing page footer sections
router.get('/footer-sections', async (req, res) => {
  try {
    const sections = await prisma.landingFooterSection.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' }
    });
    
    const settings = await prisma.systemSettings.findMany({
      where: {
        key: {
          in: ['footer_description', 'footer_address', 'footer_email', 'footer_phone', 'footer_company_name', 'footer_copyright']
        }
      }
    });

    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });

    // Parse links JSON
    const formattedSections = sections.map(s => ({
      ...s,
      links: JSON.parse(s.links || '[]')
    }));
    
    res.json({
      sections: formattedSections,
      settings: settingsObj
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /public/policy/:slug
router.get('/policy/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const [titleSetting, contentSetting] = await Promise.all([
      prisma.systemSettings.findUnique({ where: { key: `policy_${slug}_title` } }),
      prisma.systemSettings.findUnique({ where: { key: `policy_${slug}_content` } })
    ]);

    if (titleSetting && contentSetting) {
      return res.json({ slug, title: titleSetting.value, content: contentSetting.value });
    }
    res.status(404).json({ error: 'Sayfa bulunamadı' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
