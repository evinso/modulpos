const express = require('express');
const router = express.Router();
const prisma = require('../config/database');

// Get landing page pricing plans
router.get('/pricing-plans', async (req, res) => {
  try {
    const plans = await prisma.landingPricingPlan.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' }
    });
    
    // Parse features JSON
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
    
    // Parse links JSON
    const formattedSections = sections.map(s => ({
      ...s,
      links: JSON.parse(s.links || '[]')
    }));
    
    res.json(formattedSections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
