import("stdfaust.lib");

freq = hslider("freq", 50, 30, 500, 1);
gain = hslider("gain", 0.1, 0, 1, 0.01);
gate = button("gate");

lfreq = hslider("lfreq",0.5,0.01,50,0.01);
lrange = hslider("lrange[midi:ctrl 49]",300,10,5000,0.01);
lfo1 = os.lf_triangle(lfreq)*0.5+0.5;
lfo2 = os.lf_triangle(lfreq*1.01)*0.5+0.5;

process = !,! : os.sawtooth(freq)*gain*gate 
		<: 	fi.resonlp(lfo1*lrange+50,5,1), 
			fi.resonlp(lfo2*lrange+50,5,1); 

//effect = co.limiter_1176_R4_stereo;